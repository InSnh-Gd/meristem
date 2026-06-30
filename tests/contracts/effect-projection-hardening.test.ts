import { describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import type { BackfillParams } from '../../packages/contracts/src/index.ts'
import {
  ActorIdSchema,
  actorIds,
  PermissionSchema,
  permissions,
  projectionPermissions
} from '../../packages/contracts/src/index.ts'
import { rolePermissions } from '../../packages/policy/src/index.ts'

function jsonRequest(path: string, init: RequestInit = {}) {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      authorization: 'Bearer test-token',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers
    }
  })
}

describe('Effect projection hardening contracts', () => {
  it('decodes actor and permission literals from shared Effect Schema', () => {
    expect(actorIds).toEqual([
      'viewer',
      'operator',
      'admin',
      'security-admin',
      'break-glass-reviewer'
    ])
    expect(projectionPermissions).toEqual([
      'projection:read',
      'projection:backfill',
      'projection:dlq-manage'
    ])

    const actor = Schema.decodeUnknownEither(ActorIdSchema)('operator')
    const permission = Schema.decodeUnknownEither(PermissionSchema)('projection:backfill')
    const invalid = Schema.decodeUnknownEither(PermissionSchema)('core:projection')

    expect(Either.isRight(actor)).toBe(true)
    expect(Either.isRight(permission)).toBe(true)
    expect(Either.isLeft(invalid)).toBe(true)
  })

  it('keeps policy role defaults aligned with projection permission literals', () => {
    expect(permissions).toContain('projection:read')
    expect(permissions).toContain('projection:backfill')
    expect(permissions).toContain('projection:dlq-manage')

    expect(rolePermissions.viewer).not.toContain('projection:read')
    expect(rolePermissions.operator).toEqual(expect.arrayContaining(['projection:read']))
    expect(rolePermissions.operator).not.toContain('projection:backfill')
    expect(rolePermissions.operator).not.toContain('projection:dlq-manage')
    expect(rolePermissions.admin).toEqual(expect.arrayContaining(projectionPermissions))
    expect(rolePermissions['security-admin']).toEqual(expect.arrayContaining(projectionPermissions))
  })

  it('keeps Core TypeBox permission adapters aligned with shared literals', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'admin' }))
    const response = await app.handle(new Request('http://localhost/openapi/json'))
    const body = (await response.json()) as {
      paths: Record<
        string,
        Record<
          string,
          { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> }
        >
      >
    }
    const decisionSchema =
      body.paths['/api/v0/policy/decisions/{id}']?.get?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema
    const serialized = JSON.stringify(decisionSchema)

    for (const permission of permissions) {
      expect(serialized).toContain(permission)
    }
  })
})

describe('Projection permission and audit hardening routes', () => {
  it('denies viewer projection read and control operations', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'viewer' }))

    const health = await app.handle(jsonRequest('/api/v0/projection/health'))
    const dlq = await app.handle(jsonRequest('/api/v0/projection/dlq'))
    const backfill = await app.handle(
      jsonRequest('/api/v0/projection/backfill', {
        method: 'POST',
        body: JSON.stringify({ index: 'meristem-timeline-logs-v0', batchSize: 10 })
      })
    )
    const replay = await app.handle(
      jsonRequest('/api/v0/projection/dlq/dlq-1/replay', { method: 'POST' })
    )
    const skip = await app.handle(
      jsonRequest('/api/v0/projection/dlq/dlq-1/skip', { method: 'POST' })
    )

    expect(health.status).toBe(403)
    expect(dlq.status).toBe(403)
    expect(backfill.status).toBe(403)
    expect(replay.status).toBe(403)
    expect(skip.status).toBe(403)
  })

  it('allows operator projection reads but denies projection controls', async () => {
    const app = createCoreApp(createInMemoryCoreDeps({ actor: 'operator' }))

    const health = await app.handle(jsonRequest('/api/v0/projection/health'))
    const dlq = await app.handle(jsonRequest('/api/v0/projection/dlq'))
    const backfill = await app.handle(
      jsonRequest('/api/v0/projection/backfill', {
        method: 'POST',
        body: JSON.stringify({ index: 'meristem-timeline-logs-v0', batchSize: 10 })
      })
    )
    const replay = await app.handle(
      jsonRequest('/api/v0/projection/dlq/dlq-1/replay', { method: 'POST' })
    )
    const skip = await app.handle(
      jsonRequest('/api/v0/projection/dlq/dlq-1/skip', { method: 'POST' })
    )

    expect(health.status).toBe(200)
    expect(dlq.status).toBe(200)
    expect(backfill.status).toBe(403)
    expect(replay.status).toBe(403)
    expect(skip.status).toBe(403)
  })

  it('writes audit before backfill execution and timeline after success', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const calls: string[] = []
    const originalAudit = deps.log.writeAudit
    const originalTimeline = deps.log.writeTimeline
    deps.log.writeAudit = async input => {
      calls.push(`audit:${input.action}`)
      return originalAudit(input)
    }
    deps.log.writeTimeline = async input => {
      calls.push(`timeline:${input.summary}`)
      return originalTimeline(input)
    }
    deps.projection.executeBackfill = async (_params: BackfillParams) => {
      calls.push('projection:backfill')
      return {
        ok: true,
        value: {
          jobId: 'job-1',
          processedCount: 1,
          errors: 0,
          lastCursor: null,
          status: 'completed'
        }
      }
    }
    const app = createCoreApp(deps)

    const response = await app.handle(
      jsonRequest('/api/v0/projection/backfill', {
        method: 'POST',
        body: JSON.stringify({
          index: 'meristem-timeline-logs-v0',
          batchSize: 10,
          targetVersion: 'v1'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(calls[0]).toBe('audit:projection:backfill')
    expect(calls[1]).toBe('projection:backfill')
    expect(calls[2]).toBe('timeline:projection backfill completed')
  })

  it('fails closed without calling ProjectionPort when audit is unavailable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin', auditAvailable: false })
    let called = false
    deps.projection.executeBackfill = async (_params: BackfillParams) => {
      called = true
      return {
        ok: false,
        error: { code: 'unexpected.call', message: 'should not call projection' }
      }
    }
    const app = createCoreApp(deps)

    const response = await app.handle(
      jsonRequest('/api/v0/projection/backfill', {
        method: 'POST',
        body: JSON.stringify({ index: 'meristem-timeline-logs-v0', batchSize: 10 })
      })
    )

    expect(response.status).toBe(503)
    expect(called).toBe(false)
  })

  it('writes Full Log when projection control execution is unavailable', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    deps.projection.replayDLQ = async () => ({
      ok: false,
      error: { code: 'projection.unavailable', message: 'projection unavailable' }
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      jsonRequest('/api/v0/projection/dlq/dlq-1/replay', { method: 'POST' })
    )
    const fullLogs = await deps.log.listFull()

    expect(response.status).toBe(503)
    expect(
      fullLogs.ok
        ? fullLogs.value.some(entry => entry.message === 'projection control failed')
        : false
    ).toBe(true)
  })
})
