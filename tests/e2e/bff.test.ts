import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import {
  infrastructureAvailable,
  startFullStack,
  stopFullStack,
  coreFetch,
  bffFetch
} from './_shared.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: BFF', () => {
    it('skipped: PostgreSQL or NATS is not available (run docker compose up -d postgres nats)', () => {
      expect(true).toBe(true)
    })
  })
} else {
  let devAll: ManagedProcess
  let bffProcess: ManagedProcess
  let operatorToken = ''
  let viewerToken = ''
  let securityAdminToken = ''

  describe('e2e: BFF', () => {
    beforeAll(async () => {
      const stack = await startFullStack()
      devAll = stack.devAll
      bffProcess = stack.bffProcess
      operatorToken = stack.operatorToken
      viewerToken = stack.viewerToken
      securityAdminToken = stack.securityAdminToken
    }, 60_000)

    afterAll(async () => {
      await stopFullStack(devAll, bffProcess)
    }, 30_000)

    describe('health & ready', () => {
      it('health returns ok', async () => {
        const res = await bffFetch('/health')
        expect(res.ok).toBe(true)
        const body = res.data as { ok: boolean; service: string }
        expect(body.service).toBe('m-ui-bff')
      })

      it('ready returns ready when Core healthy', async () => {
        const res = await bffFetch('/ready')
        expect(res.ok).toBe(true)
        const body = res.data as { ready: boolean }
        expect(body.ready).toBe(true)
      })
    })

    describe('overview', () => {
      it('returns correct shape with operator token', async () => {
        const res = await bffFetch('/api/v0/overview', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as {
          session: { actor: string; permissions: string[] }
          core: { id: string }
          nodes: Array<unknown>
          services: Array<unknown>
          timeline: Array<unknown>
          auditAccessible: boolean
          audit: unknown
        }
        expect(body.session.actor).toBe('operator')
        expect(body.session.permissions).toContain('task:assign')
        expect(body.core.id).toBe('meristem-core')
        expect(Array.isArray(body.nodes)).toBe(true)
        expect(Array.isArray(body.services)).toBe(true)
        expect(Array.isArray(body.timeline)).toBe(true)
        expect(body.auditAccessible).toBe(true)
        expect(body.audit).not.toBeNull()
      })

      it('returns 401 without token', async () => {
        const res = await bffFetch('/api/v0/overview')
        expect(res.status).toBe(401)
      })

      it('with viewer token shows auditAccessible false', async () => {
        const res = await bffFetch('/api/v0/overview', viewerToken)
        expect(res.ok).toBe(true)
        const body = res.data as { session: { actor: string }; auditAccessible: boolean }
        expect(body.session.actor).toBe('viewer')
        expect(body.auditAccessible).toBe(false)
      })

      it('with security-admin token reveals audit', async () => {
        const res = await bffFetch('/api/v0/overview', securityAdminToken)
        expect(res.ok).toBe(true)
        const body = res.data as { auditAccessible: boolean; audit: unknown }
        expect(body.auditAccessible).toBe(true)
        expect(body.audit).not.toBeNull()
      })
    })

    describe('policy decision summary', () => {
      it('returns redacted decision', async () => {
        const decisionsRes = await coreFetch('/api/v0/policy/decisions', operatorToken)
        const decisions = (decisionsRes.data as { decisions: Array<{ id: string }> }).decisions
        expect(decisions.length).toBeGreaterThan(0)
        const id = decisions[0].id

        const res = await bffFetch(`/api/v0/policy/decisions/${id}/summary`, operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { decision: { id: string; actor: string; action: string; resource: string; result: string; createdAt: string } }
        expect(body.decision.id).toBe(id)
        expect(body.decision.result).toBeDefined()
        expect(body.decision).not.toHaveProperty('reasons')
      })
    })

    describe('noop command', () => {
      it('enabled for reachable leaf with operator', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find((n) => n.name === 'e2e-leaf')
        expect(leaf).toBeDefined()
        const res = await bffFetch('/api/v0/commands/noop', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: leaf!.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { state: string; command?: { label: string }; disabledReason?: string }
        expect(body.state).toBe('enabled')
        expect(body.command?.label).toBe('运行 noop 任务')
      })

      it('disabled for viewer (missing task:assign)', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string }> }).nodes
        const res = await bffFetch('/api/v0/commands/noop', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: nodes[0].id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { state: string; disabledReason: string }
        expect(body.state).toBe('disabled')
        expect(body.disabledReason).toContain('task:assign')
      })
    })

    describe('noop execute', () => {
      it('returns task result', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find((n) => n.name === 'e2e-leaf')
        expect(leaf).toBeDefined()
        const res = await bffFetch('/api/v0/commands/noop/execute', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: leaf!.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { task: { id: string; status: string } }
        expect(body.task.status).toBe('completed')
      })
    })

    describe('node detail passthrough', () => {
      it('returns node from Core', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string }> }).nodes
        const res = await bffFetch(`/api/v0/nodes/${nodes[0].id}`, operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { node: { id: string } }
        expect(body.node.id).toBe(nodes[0].id)
      })
    })
  })
}
