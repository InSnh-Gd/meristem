import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { ManagedProcess } from '../helpers/process.ts'
import {
  bffFetch,
  coreFetch,
  infrastructureAvailable,
  startFullStack,
  stopFullStack
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
  let adminToken = ''
  let viewerToken = ''
  let securityAdminToken = ''
  let leafName = ''

  describe('e2e: BFF', () => {
    beforeAll(async () => {
      const stack = await startFullStack()
      devAll = stack.devAll
      bffProcess = stack.bffProcess
      operatorToken = stack.operatorToken
      adminToken = stack.adminToken
      viewerToken = stack.viewerToken
      securityAdminToken = stack.securityAdminToken
      leafName = `e2e-bff-leaf-${Date.now()}`
      const leaf = await coreFetch('/api/v0/nodes', operatorToken, {
        method: 'POST',
        body: JSON.stringify({ kind: 'leaf', name: leafName, mode: 'simulated' })
      })
      expect(leaf.ok).toBe(true)
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
        expect(body.session.permissions).toContain('task:submit')
        expect(body.core.id).toBe('meristem-core')
        expect(Array.isArray(body.nodes)).toBe(true)
        expect(Array.isArray(body.services)).toBe(true)
        expect(Array.isArray(body.timeline)).toBe(true)
        expect(body.auditAccessible).toBe(false)
        expect(body.audit).toBeNull()
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
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken, {
          method: 'POST',
          body: JSON.stringify({
            kind: 'leaf',
            name: `summary-leaf-${Date.now()}`,
            mode: 'simulated'
          })
        })
        const id = (nodeRes.data as { policyDecisionId: string }).policyDecisionId

        const res = await bffFetch(`/api/v0/policy/decisions/${id}/summary`, operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as {
          decision: {
            id: string
            actor: string
            action: string
            resource: string
            result: string
            createdAt: string
          }
        }
        expect(body.decision.id).toBe(id)
        expect(body.decision.result).toBeDefined()
        expect(body.decision).not.toHaveProperty('reasons')
      })
    })

    describe('noop command', () => {
      it('enabled for reachable leaf with operator', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find(n => n.name === leafName)
        expect(leaf).toBeDefined()
        if (!leaf) throw new Error('missing leaf for noop command eligibility test')
        const res = await bffFetch('/api/v0/commands/noop', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: leaf.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as {
          state: string
          command?: { label: string }
          disabledReason?: string
        }
        expect(body.state).toBe('enabled')
        expect(body.command?.label).toBe('运行 noop 任务')
      })

      it('disabled for viewer (missing task:submit)', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string }> }).nodes
        const firstNode = nodes[0]
        expect(firstNode).toBeDefined()
        if (!firstNode) throw new Error('missing node for viewer eligibility test')
        const res = await bffFetch('/api/v0/commands/noop', viewerToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: firstNode.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { state: string; disabledReason: string }
        expect(body.state).toBe('disabled')
        expect(body.disabledReason).toContain('task:submit')
      })
    })

    describe('noop execute', () => {
      it('returns task result', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find(n => n.name === leafName)
        expect(leaf).toBeDefined()
        if (!leaf) throw new Error('missing leaf for noop execute test')
        const res = await bffFetch('/api/v0/commands/noop/execute', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: leaf.id })
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
        const firstNode = nodes[0]
        expect(firstNode).toBeDefined()
        if (!firstNode) throw new Error('missing node for node detail passthrough test')

        const res = await bffFetch(`/api/v0/nodes/${firstNode.id}`, operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { node: { id: string } }
        expect(body.node.id).toBe(firstNode.id)
      })
    })

    describe('SDUI v0.2 BFF routes', () => {
      it('GET /api/v0/routes returns route list', async () => {
        const res = await bffFetch('/api/v0/routes', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { routes: Array<{ id: string }> }
        expect(Array.isArray(body.routes)).toBe(true)
        expect(body.routes.some(route => route.id === 'control-room.overview')).toBe(true)
      })

      it('GET /api/v0/routes/:id returns a known route', async () => {
        const res = await bffFetch('/api/v0/routes/control-room.overview', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { route: { id: string } }
        expect(body.route.id).toBe('control-room.overview')
      })

      it('GET /api/v0/routes/:id returns 404 for an unknown route', async () => {
        const res = await bffFetch('/api/v0/routes/unknown.route', operatorToken)
        expect(res.status).toBe(404)
      })

      it('GET /api/v0/nodes returns node array', async () => {
        const res = await bffFetch('/api/v0/nodes', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { nodes: Array<{ id: string; name: string }> }
        expect(Array.isArray(body.nodes)).toBe(true)
        expect(body.nodes.some(node => node.name === leafName)).toBe(true)
      })

      it('GET /api/v0/timeline returns timeline entries', async () => {
        const res = await bffFetch('/api/v0/timeline', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ id: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('GET /api/v0/audit returns audit entries for security admin', async () => {
        const res = await bffFetch('/api/v0/audit', securityAdminToken)
        expect(res.ok).toBe(true)
        const body = res.data as { entries: Array<{ id: string }> }
        expect(Array.isArray(body.entries)).toBe(true)
      })

      it('GET /api/v0/policy/decisions returns decision list', async () => {
        const res = await bffFetch('/api/v0/policy/decisions', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { decisions: Array<{ id: string }> }
        expect(Array.isArray(body.decisions)).toBe(true)
      })

      it('GET /api/v0/policy/approvals returns approval queue as 200 with approvals array', async () => {
        const res = await bffFetch('/api/v0/policy/approvals', adminToken)
        expect(res.ok).toBe(true)
        const body = res.data as { approvals: Array<{ id: string }> }
        expect(Array.isArray(body.approvals)).toBe(true)
      })

      it('GET /api/v0/policy/approvals/:id returns 404 Core envelope for unknown approval', async () => {
        const res = await bffFetch('/api/v0/policy/approvals/missing-approval', adminToken)
        expect(res.status).toBe(404)
        const body = res.data as { error: { code: string } }
        expect(body.error.code).toBe('approval.not_found')
      })

      it('GET /api/v0/network/profiles returns profiles and CN controlPlaneOnly profile', async () => {
        const res = await bffFetch('/api/v0/network/profiles', adminToken)
        expect(res.ok).toBe(true)
        const body = res.data as {
          profiles: Array<{
            profileVersion: string
            capabilities: { controlPlaneOnly: boolean }
          }>
        }
        expect(Array.isArray(body.profiles)).toBe(true)
        const cnProfile = body.profiles.find(profile => profile.profileVersion === 'm-net-cn@0.1.0')
        expect(cnProfile).toBeDefined()
        expect(cnProfile?.capabilities.controlPlaneOnly).toBe(true)
      })

      it('approval/profile routes preserve 401 and 403 permission failures', async () => {
        const missingApprovalToken = await bffFetch('/api/v0/policy/approvals')
        expect(missingApprovalToken.status).toBe(401)
        const missingApprovalBody = missingApprovalToken.data as { error: { code: string } }
        expect(missingApprovalBody.error.code).toBe('auth.missing_token')

        const deniedApproval = await bffFetch('/api/v0/policy/approvals', operatorToken)
        expect(deniedApproval.status).toBe(403)
        const deniedApprovalBody = deniedApproval.data as { error: { code: string } }
        expect(deniedApprovalBody.error.code).toBe('policy.denied')

        const deniedProfile = await bffFetch('/api/v0/network/profiles', viewerToken)
        expect(deniedProfile.status).toBe(403)
        const deniedProfileBody = deniedProfile.data as { error: { code: string } }
        expect(deniedProfileBody.error.code).toBe('policy.denied')
      })

      it('GET /api/v0/services returns service list', async () => {
        const res = await bffFetch('/api/v0/services', operatorToken)
        expect(res.ok).toBe(true)
        const body = res.data as { services: Array<{ id: string }> }
        expect(Array.isArray(body.services)).toBe(true)
      })

      it('POST /api/v0/commands/task.noop.submit/eligibility returns command eligibility', async () => {
        const nodeRes = await coreFetch('/api/v0/nodes', operatorToken)
        const nodes = (nodeRes.data as { nodes: Array<{ id: string; name: string }> }).nodes
        const leaf = nodes.find(node => node.name === leafName)
        expect(leaf).toBeDefined()
        if (!leaf) throw new Error(`missing e2e leaf: ${leafName}`)

        const res = await bffFetch('/api/v0/commands/task.noop.submit/eligibility', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: leaf.id })
        })
        expect(res.ok).toBe(true)
        const body = res.data as { state: string; command: { id: string } }
        expect(body.state).toBe('enabled')
        expect(body.command.id).toBe('task.noop.submit')
      })

      it('POST /api/v0/commands/unknown/eligibility returns 400', async () => {
        const res = await bffFetch('/api/v0/commands/unknown/eligibility', operatorToken, {
          method: 'POST',
          body: JSON.stringify({ leafNodeId: 'leaf-placeholder' })
        })
        expect(res.status).toBe(400)
      })
    })
  })
}
