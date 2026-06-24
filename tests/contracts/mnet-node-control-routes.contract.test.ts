import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mintLocalToken } from '../../packages/auth/src/index.ts'
import type { MNode } from '../../packages/contracts/src/index.ts'
import { createMNetApp } from '../../services/m-net/src/app.ts'
import type { MNetAppDeps } from '../../services/m-net/src/deps.ts'

const jwtSecret = 'mnet-node-control-jwt-secret'

function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

async function mintToken(actor: 'operator' | 'admin'): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

function createNodeControlFixture(node: MNode, statuses: string[] = []) {
  const app = createMNetApp({
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false as const, error: { code: 'test.unused', message: 'unused' } }
    },
    async listNetworks() {
      return { ok: true as const, value: [] }
    },
    async joinNetwork() {
      return { ok: false as const, error: { code: 'test.unused', message: 'unused' } }
    },
    async listMembers() {
      return { ok: true as const, value: [] }
    },
    async executeNoop() {
      return { ok: false as const, error: { code: 'test.unused', message: 'unused' } }
    },
    async controlNode(input) {
      if (statuses.includes('deny')) {
        return {
          kind: 'failure' as const,
          status: 403 as const,
          error: { code: 'policy.denied', message: 'node disable denied: denied' }
        }
      }
      return {
        node:
          input.action === 'switch-role'
            ? { ...node, kind: input.targetKind ?? node.kind }
            : { ...node, status: input.action === 'recover' ? 'recovering' : 'disabled' },
        policyDecisionId: 'decision-1',
        correlationId: 'corr-1'
      }
    }
  } satisfies MNetAppDeps)

  return { app }
}

describe('M-Net node control routes', () => {
  const originalJwtSecret = process.env.MERISTEM_JWT_SECRET

  beforeEach(() => {
    process.env.MERISTEM_JWT_SECRET = jwtSecret
  })

  afterEach(() => {
    if (originalJwtSecret === undefined) delete process.env.MERISTEM_JWT_SECRET
    else process.env.MERISTEM_JWT_SECRET = originalJwtSecret
  })

  it('returns workflow result for valid node control request', async () => {
    const token = await mintToken('operator')
    const node: MNode = {
      id: 'node-1',
      kind: 'leaf',
      name: 'leaf-1',
      mode: 'agent',
      status: 'healthy',
      reachability: 'reachable',
      capabilities: [],
      createdAt: '2026-06-24T00:00:00.000Z'
    }
    const fixture = createNodeControlFixture(node)

    const response = await fixture.app.handle(
      new Request('http://localhost/api/v0/nodes/node-1/control', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ action: 'disable', reason: 'operator request' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      node: { ...node, status: 'disabled' },
      policyDecisionId: 'decision-1',
      correlationId: 'corr-1'
    })
  })

  it('maps workflow denial into external API error envelope', async () => {
    const token = await mintToken('operator')
    const node: MNode = {
      id: 'node-1',
      kind: 'leaf',
      name: 'leaf-1',
      mode: 'agent',
      status: 'healthy',
      reachability: 'reachable',
      capabilities: [],
      createdAt: '2026-06-24T00:00:00.000Z'
    }
    const fixture = createNodeControlFixture(node, ['deny'])

    const response = await fixture.app.handle(
      new Request('http://localhost/api/v0/nodes/node-1/control', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({ action: 'disable', reason: 'operator request' })
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'policy.denied',
        message: 'node disable denied: denied'
      }
    })
  })

  it('accepts switch-role requests with an explicit target kind', async () => {
    const token = await mintToken('operator')
    const node: MNode = {
      id: 'node-1',
      kind: 'leaf',
      name: 'leaf-1',
      mode: 'agent',
      status: 'healthy',
      reachability: 'reachable',
      capabilities: [],
      createdAt: '2026-06-24T00:00:00.000Z'
    }
    const fixture = createNodeControlFixture(node)

    const response = await fixture.app.handle(
      new Request('http://localhost/api/v0/nodes/node-1/control', {
        method: 'POST',
        headers: bearerHeaders(token),
        body: JSON.stringify({
          action: 'switch-role',
          targetKind: 'stem',
          reason: 'promote relay root'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      node: { ...node, kind: 'stem' },
      policyDecisionId: 'decision-1',
      correlationId: 'corr-1'
    })
  })
})
