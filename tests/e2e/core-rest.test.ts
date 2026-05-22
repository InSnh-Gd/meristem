import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import {
  infrastructureAvailable,
  startFullStack,
  stopFullStack,
  coreFetch
} from './_shared.ts'

const infraOk = await infrastructureAvailable()

if (!infraOk) {
  describe('e2e: Core REST', () => {
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

  describe('e2e: Core REST', () => {
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

    describe('public endpoints', () => {
      it('health returns ok', async () => {
        const res = await coreFetch('/api/v0/health')
        expect(res.ok).toBe(true)
        expect(res.status).toBe(200)
        const body = res.data as { ok: boolean; service: string }
        expect(body.ok).toBe(true)
        expect(body.service).toBe('meristem-core')
      })

      it('ready returns ready state', async () => {
        const res = await coreFetch('/api/v0/ready')
        expect(res.ok).toBe(true)
        expect(res.status).toBe(200)
        const body = res.data as { ready: boolean; dependencies: Record<string, unknown> }
        expect(typeof body.ready).toBe('boolean')
        expect(typeof body.dependencies).toBe('object')
      })
    })

    describe('auth & session', () => {
      it('session returns operator permissions', async () => {
        const res = await coreFetch('/api/v0/session', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { actor: string; permissions: string[] }
        expect(body.actor).toBe('operator')
        expect(body.permissions).toContain('task:assign')
        expect(body.permissions).toContain('audit:read')
      })

      it('session returns viewer permissions without audit:read', async () => {
        const res = await coreFetch('/api/v0/session', viewerToken)
        expect(res.ok).toBe(true)
        const body = res.data as { actor: string; permissions: string[] }
        expect(body.actor).toBe('viewer')
        expect(body.permissions).not.toContain('audit:read')
      })

      it('missing token returns 401', async () => {
        const res = await coreFetch('/api/v0/status')
        expect(res.status).toBe(401)
      })

      it('invalid token returns 401', async () => {
        const res = await coreFetch('/api/v0/status', 'bad-token')
        expect(res.status).toBe(401)
      })

      it('viewer cannot read status (403)', async () => {
        const res = await coreFetch('/api/v0/status', viewerToken)
        expect(res.status).toBe(403)
      })
    })

    describe('status', () => {
      it('operator reads status shape', async () => {
        const res = await coreFetch('/api/v0/status', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as {
          core: { id: string; version: string; mode: string }
          dependencies: Record<string, unknown>
          counts: { services: number; nodes: number; tasks: number }
        }
        expect(body.core.id).toBe('meristem-core')
        expect(body.core.mode).toBe('normal')
        expect(typeof body.counts.services).toBe('number')
        expect(typeof body.counts.nodes).toBe('number')
        expect(typeof body.counts.tasks).toBe('number')
      })
    })

    describe('nodes', () => {
      it('registers a simulated stem node', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'stem', name: 'e2e-stem', mode: 'simulated' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { node: { id: string; kind: string; name: string; mode: string; status: string } }
        expect(body.node.kind).toBe('stem')
        expect(body.node.name).toBe('e2e-stem')
        expect(body.node.mode).toBe('simulated')
        expect(body.node.status).toBe('healthy')
      })

      it('registers a simulated leaf node', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'e2e-leaf', mode: 'simulated' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { node: { id: string; kind: string; name: string; mode: string } }
        expect(body.node.kind).toBe('leaf')
        expect(body.node.name).toBe('e2e-leaf')
        expect(body.node.mode).toBe('simulated')
      })

      it('lists nodes including registered ones', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { nodes: Array<{ name: string }> }
        const names = body.nodes.map((n) => n.name)
        expect(names).toContain('e2e-stem')
        expect(names).toContain('e2e-leaf')
      })

      it('viewer cannot register node (403)', async () => {
        const res = await coreFetch('/api/v0/nodes', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'viewer-leaf' })
        })
        expect(res.status).toBe(403)
      })

      it('agent mode registration returns 409', async () => {
        const res = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'e2e-agent-leaf', mode: 'agent' })
        })
        expect(res.status).toBe(409)
      })

      it('creates a join ticket for a leaf node', async () => {
        const res = await coreFetch('/api/v0/node-tickets', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ kind: 'leaf', name: 'e2e-ticket-leaf' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { ticketId: string; ticket: string; joinUrl: string; policyDecisionId: string }
        expect(typeof body.ticketId).toBe('string')
        expect(typeof body.ticket).toBe('string')
        expect(body.joinUrl).toContain('8443')
        expect(typeof body.policyDecisionId).toBe('string')
      })

      it('issues node credential', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find((n) => n.name === 'e2e-leaf')
        expect(leaf).toBeDefined()
        const res = await coreFetch(`/api/v0/nodes/${leaf!.id}/credentials`, operatorToken, { method: 'POST' })
        expect(res.ok).toBe(true)
        const body = res.data as { nodeId: string; token: string; policyDecisionId: string }
        expect(body.nodeId).toBe(leaf!.id)
        expect(typeof body.token).toBe('string')
      })

      it('viewer cannot issue node token (403)', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string }> }).nodes
        const res = await coreFetch(`/api/v0/nodes/${nodes[0].id}/credentials`, viewerToken, { method: 'POST' })
        expect(res.status).toBe(403)
      })
    })

    describe('tasks', () => {
      it('assigns noop task to simulated leaf', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find((n) => n.name === 'e2e-leaf')
        expect(leaf).toBeDefined()
        const res = await coreFetch('/api/v0/tasks', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: leaf!.id, type: 'noop' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { task: { id: string; status: string; leafNodeId: string; type: string }; policyDecisionId: string }
        expect(body.task.status).toBe('completed')
        expect(body.task.type).toBe('noop')
      })

      it('viewer cannot assign task (403)', async () => {
        const listRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (listRes.data as { nodes: Array<{ id: string }> }).nodes
        const res = await coreFetch('/api/v0/tasks', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: nodes[0].id, type: 'noop' })
        })
        expect(res.status).toBe(403)
      })
    })

    describe('networks', () => {
      it('creates a logical network', async () => {
        const res = await coreFetch('/api/v0/networks', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ name: 'e2e-net' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { network: { id: string; name: string }; policyDecisionId: string }
        expect(body.network.name).toBe('e2e-net')
        expect(typeof body.network.id).toBe('string')
      })

      it('lists networks', async () => {
        const res = await coreFetch('/api/v0/networks', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { networks: Array<{ name: string }> }
        expect(body.networks.some((n) => n.name === 'e2e-net')).toBe(true)
      })

      it('joins a stem node to the network', async () => {
        const netRes = await coreFetch('/api/v0/networks', operatorToken)
        const nets = (netRes.data as { networks: Array<{ id: string; name: string }> }).networks
        const net = nets.find((n) => n.name === 'e2e-net')
        expect(net).toBeDefined()

        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const stem = nodes.find((n) => n.name === 'e2e-stem')
        expect(stem).toBeDefined()

        const res = await coreFetch(`/api/v0/networks/${net!.id}/members`, operatorToken, {
          method: 'POST',
          body: JSON.stringify({ nodeId: stem!.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { member: { networkId: string; nodeId: string } }
        expect(body.member.networkId).toBe(net!.id)
        expect(body.member.nodeId).toBe(stem!.id)
      })

      it('viewer cannot create network (403)', async () => {
        const res = await coreFetch('/api/v0/networks', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ name: 'viewer-net' })
        })
        expect(res.status).toBe(403)
      })
    })

    describe('services', () => {
      it('lists services', async () => {
        const res = await coreFetch('/api/v0/services', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { services: Array<{ id: string; status: string }> }
        expect(Array.isArray(body.services)).toBe(true)
      })

      it('reloads a service', async () => {
        const res = await coreFetch('/api/v0/services/m-log/reload', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ reason: 'e2e smoke' })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { serviceId: string; accepted: boolean }
        expect(body.serviceId).toBe('m-log')
        expect(body.accepted).toBe(true)
      })

      it('viewer cannot reload service (403)', async () => {
        const res = await coreFetch('/api/v0/services/m-log/reload', viewerToken, {
          method: 'POST',
          body: JSON.stringify({})
        })
        expect(res.status).toBe(403)
      })
    })

    describe('logs', () => {
      it('operator reads timeline', async () => {
        const res = await coreFetch('/api/v0/logs/timeline', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ summary: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('operator reads full logs', async () => {
        const res = await coreFetch('/api/v0/logs/full', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ level: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('security-admin reads audit logs', async () => {
        const res = await coreFetch('/api/v0/audit', securityAdminToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ actor: string; action: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
        expect(body.entries.length).toBeGreaterThan(0)
      })

      it('operator cannot read audit (403)', async () => {
        const res = await coreFetch('/api/v0/audit', operatorToken)
        expect(res.status).toBe(403)
      })

      it('viewer cannot read full logs (403)', async () => {
        const res = await coreFetch('/api/v0/logs/full', viewerToken)
        expect(res.status).toBe(403)
      })
    })

    describe('policy', () => {
      it('lists policy decisions', async () => {
        const res = await coreFetch('/api/v0/policy/decisions', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { decisions: Array<{ id: string; actor: string; result: string }> }
        expect(Array.isArray(body.decisions)).toBe(true)
        expect(body.decisions.length).toBeGreaterThan(0)
      })
    })
  })
}
