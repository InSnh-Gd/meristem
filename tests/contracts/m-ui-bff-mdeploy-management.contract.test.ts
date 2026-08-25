import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  captureOriginalFetch,
  createBffWithServices,
  makeRequest,
  restoreOriginalFetch
} from './_helpers/m-ui-bff.ts'

beforeAll(async () => {
  captureOriginalFetch()
})

afterAll(() => {
  restoreOriginalFetch()
})

// ---------------------------------------------------------------------------
// Mock Core app that serves M-Deploy management endpoints
// ---------------------------------------------------------------------------

// Topology fixture wrapped in the envelope the BFF route expects:
// { topology: MDeployInfrastructureTopologyV01Schema }
const TOPOLOGY_CORE_BODY = {
  topology: {
    schemaVersion: 'mdeploy.infrastructure-topology@0.1.0' as const,
    topologyId: 'test-topology-1',
    revision: 'rev-1',
    network: { networkId: 'net-1', cidr: '10.0.0.0/16' },
    nodes: [
      {
        nodeId: 'node-1',
        workloadClass: 'control-state',
        failureDomain: 'zone-a',
        resources: { vcpu: 2, memoryMiB: 4096, diskGiB: 50 },
        runtimeDriver: 'podman' as const
      }
    ]
  }
}

// Status fixture matches desiredStateSummarySchema:
// { latestDigest?, lastSuccessfulDigest?, syncedAt?, stale, controllerAvailable }
const DESIRED_STATE_SUMMARY_BODY = {
  latestDigest: { algorithm: 'sha256' as const, value: 'sha256:abc123' },
  lastSuccessfulDigest: { algorithm: 'sha256' as const, value: 'sha256:abc123' },
  syncedAt: '2026-07-20T00:00:00.000Z',
  stale: false,
  controllerAvailable: true
}

// Evidence history fixture wrapped in envelope:
// { evidence: Array<MDeployEvidenceMetadataV01Schema> }
const EVIDENCE_HISTORY_BODY = {
  evidence: [
    {
      schemaVersion: 'mdeploy.evidence-metadata@0.1.0' as const,
      operationId: 'op-1',
      correlationId: 'corr-1',
      auditId: 'audit-1',
      evidenceType: 'runtime_apply' as const,
      timestamp: '2026-07-20T01:00:00.000Z',
      storageRef: {
        uri: 'https://storage.example/evidence/ev-1.json',
        digest: { algorithm: 'sha256' as const, value: 'sha256:deadbeef' },
        redactionStatus: 'metadata_only' as const
      }
    }
  ]
}

// Operation response fixture matches operationResponseSchema:
// { operation: { operationId, kind, agentId, status, ... } }
const APPLY_OPERATION_BODY = {
  operation: {
    operationId: 'op-apply-1',
    kind: 'apply' as const,
    agentId: 'agent-1',
    status: 'queued' as const,
    policyDecisionId: 'pd-1',
    auditId: 'audit-1',
    correlationId: 'corr-1',
    createdAt: '2026-07-20T01:00:00.000Z'
  }
}

const ROLLBACK_OPERATION_BODY = {
  operation: {
    operationId: 'op-rollback-1',
    kind: 'rollback' as const,
    agentId: 'agent-1',
    status: 'queued' as const,
    policyDecisionId: 'pd-2',
    auditId: 'audit-2',
    correlationId: 'corr-2',
    createdAt: '2026-07-20T02:00:00.000Z'
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

type MockCoreOptions = {
  topologyAvailable?: boolean
  topologyData?: unknown
  desiredStateAvailable?: boolean
  evidenceAvailable?: boolean
  applyResult?: { ok: boolean; status: number; body: unknown }
  rollbackResult?: { ok: boolean; status: number; body: unknown }
}

function createMockCoreApp(options?: MockCoreOptions) {
  const topologyAvailable = options?.topologyAvailable !== false
  const desiredStateAvailable = options?.desiredStateAvailable !== false
  const evidenceAvailable = options?.evidenceAvailable !== false

  return {
    handle(request: Request): Response | Promise<Response> {
      const url = new URL(request.url)
      const method = request.method

      if (method === 'GET' && url.pathname === '/api/v0/deploy/infrastructure/topology') {
        if (!topologyAvailable) {
          return json({ error: { code: 'deploy.not_found', message: 'topology not found' } }, 404)
        }
        if (options?.topologyData !== undefined) {
          return json(options.topologyData)
        }
        return json(TOPOLOGY_CORE_BODY)
      }

      if (method === 'GET' && url.pathname === '/api/v0/deploy/desired-state') {
        if (!desiredStateAvailable) {
          return json(
            { error: { code: 'deploy.not_found', message: 'desired state not found' } },
            404
          )
        }
        return json(DESIRED_STATE_SUMMARY_BODY)
      }

      if (method === 'GET' && url.pathname === '/api/v0/deploy/evidence') {
        if (!evidenceAvailable) {
          return json({ error: { code: 'deploy.not_found', message: 'evidence not found' } }, 404)
        }
        return json(EVIDENCE_HISTORY_BODY)
      }

      if (method === 'POST' && url.pathname === '/api/v0/deploy/apply') {
        const result = options?.applyResult
        if (result) return json(result.body, result.status)
        return json(APPLY_OPERATION_BODY, 202)
      }

      if (method === 'POST' && url.pathname === '/api/v0/deploy/rollback') {
        const result = options?.rollbackResult
        if (result) return json(result.body, result.status)
        return json(ROLLBACK_OPERATION_BODY, 202)
      }

      return json({ error: { code: 'not_found', message: 'route not matched' } }, 404)
    }
  }
}

function createBffWithDeployCore(options?: {
  topologyAvailable?: boolean
  topologyData?: unknown
  desiredStateAvailable?: boolean
  evidenceAvailable?: boolean
  applyResult?: { ok: boolean; status: number; body: unknown }
  rollbackResult?: { ok: boolean; status: number; body: unknown }
}) {
  const coreApp = createMockCoreApp(options)
  return createBffWithServices({ coreApp })
}

describe('M-Deploy BFF management routes', () => {
  // -----------------------------------------------------------------------
  // Auth rejection
  // -----------------------------------------------------------------------

  describe('auth rejection', () => {
    it('GET /api/v0/deploy/topology returns 401 without token', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/topology')
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('auth.missing_token')
    })

    it('GET /api/v0/deploy/status returns 401 without token', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/status')
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('auth.missing_token')
    })

    it('GET /api/v0/deploy/history returns 401 without token', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/history')
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('auth.missing_token')
    })

    it('POST /api/v0/deploy/apply returns 401 without token', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/apply', 'POST', undefined, {
        proposalId: 'prop-1',
        agentId: 'agent-1'
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('auth.missing_token')
    })

    it('POST /api/v0/deploy/rollback returns 401 without token', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/rollback', 'POST', undefined, {
        agentId: 'agent-1',
        targetDigest: { algorithm: 'sha256', value: 'sha256:abc123' }
      })
      expect(res.status).toBe(401)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('auth.missing_token')
    })
  })

  // -----------------------------------------------------------------------
  // Successful responses
  // -----------------------------------------------------------------------

  describe('successful responses', () => {
    it('GET /api/v0/deploy/topology returns topology from Core', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/topology', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        topology: { topologyId: string; nodes: unknown[] }
        stateSource: { sourceType: string; sourceId: string }
      }
      expect(body.topology.topologyId).toBe('test-topology-1')
      expect(Array.isArray(body.topology.nodes)).toBe(true)
      expect(body.topology.nodes).toHaveLength(1)
      expect(body.stateSource.sourceType).toBe('authoritative')
    })

    it('GET /api/v0/deploy/status returns desired state from Core', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/status', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        status: { stale: boolean; controllerAvailable: boolean }
        stateSource: { sourceType: string; sourceId: string }
      }
      expect(body.status.stale).toBe(false)
      expect(body.status.controllerAvailable).toBe(true)
      expect(body.stateSource.sourceType).toBe('authoritative')
    })

    it('GET /api/v0/deploy/history returns evidence entries from Core', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/history', 'GET', 'operator-token')
      expect(res.status).toBe(200)
      const body = (await res.json()) as {
        evidence: Array<{ operationId: string; evidenceType: string }>
        stateSource: { sourceType: string; sourceId: string }
      }
      expect(Array.isArray(body.evidence)).toBe(true)
      expect(body.evidence[0]?.operationId).toBe('op-1')
      expect(body.evidence[0]?.evidenceType).toBe('runtime_apply')
      expect(body.stateSource.sourceType).toBe('audit')
    })

    it('POST /api/v0/deploy/apply proxies apply request to Core', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/apply', 'POST', 'operator-token', {
        proposalId: 'prop-1',
        agentId: 'agent-1'
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { operation: { operationId: string; kind: string } }
      expect(body.operation.operationId).toBe('op-apply-1')
      expect(body.operation.kind).toBe('apply')
    })

    it('POST /api/v0/deploy/rollback proxies rollback request to Core', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/rollback', 'POST', 'operator-token', {
        agentId: 'agent-1',
        targetDigest: { algorithm: 'sha256', value: 'sha256:abc123' }
      })
      expect(res.status).toBe(200)
      const body = (await res.json()) as { operation: { operationId: string; kind: string } }
      expect(body.operation.operationId).toBe('op-rollback-1')
      expect(body.operation.kind).toBe('rollback')
    })
  })

  // -----------------------------------------------------------------------
  // Upstream error passthrough
  // -----------------------------------------------------------------------

  describe('upstream error passthrough', () => {
    it('GET /api/v0/deploy/topology passes through 404 from Core', async () => {
      const app = createBffWithDeployCore({ topologyAvailable: false })
      const res = await makeRequest(app, '/api/v0/deploy/topology', 'GET', 'operator-token')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('deploy.not_found')
    })

    it('GET /api/v0/deploy/status passes through 404 from Core', async () => {
      const app = createBffWithDeployCore({ desiredStateAvailable: false })
      const res = await makeRequest(app, '/api/v0/deploy/status', 'GET', 'operator-token')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('deploy.not_found')
    })

    it('GET /api/v0/deploy/history passes through 404 from Core', async () => {
      const app = createBffWithDeployCore({ evidenceAvailable: false })
      const res = await makeRequest(app, '/api/v0/deploy/history', 'GET', 'operator-token')
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('deploy.not_found')
    })

    it('POST /api/v0/deploy/apply passes through upstream error', async () => {
      const app = createBffWithDeployCore({
        applyResult: {
          ok: false,
          status: 409,
          body: { error: { code: 'deploy.conflict', message: 'proposal already applied' } }
        }
      })
      const res = await makeRequest(app, '/api/v0/deploy/apply', 'POST', 'operator-token', {
        proposalId: 'prop-1',
        agentId: 'agent-1'
      })
      expect(res.status).toBe(409)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('deploy.conflict')
    })

    it('POST /api/v0/deploy/rollback passes through upstream error', async () => {
      const app = createBffWithDeployCore({
        rollbackResult: {
          ok: false,
          status: 400,
          body: { error: { code: 'deploy.invalid_target', message: 'target digest not found' } }
        }
      })
      const res = await makeRequest(app, '/api/v0/deploy/rollback', 'POST', 'operator-token', {
        agentId: 'agent-1',
        targetDigest: { algorithm: 'sha256', value: 'sha256:nonexistent' }
      })
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('deploy.invalid_target')
    })
  })

  // -----------------------------------------------------------------------
  // Schema validation (POST routes reject malformed bodies)
  // -----------------------------------------------------------------------

  describe('invalid upstream response', () => {
    it('GET /api/v0/deploy/topology returns 502 when Core returns schema-invalid payload', async () => {
      const app = createBffWithDeployCore({
        topologyData: { topology: { totally: 'invalid' } }
      })
      const res = await makeRequest(app, '/api/v0/deploy/topology', 'GET', 'operator-token')
      expect(res.status).toBe(502)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('bff.invalid_upstream_response')
    })
  })

  describe('schema validation', () => {
    it('POST /api/v0/deploy/apply rejects missing proposalId', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/apply', 'POST', 'operator-token', {
        agentId: 'agent-1'
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/deploy/apply rejects missing agentId', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/apply', 'POST', 'operator-token', {
        proposalId: 'prop-1'
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/deploy/apply rejects empty proposalId', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/apply', 'POST', 'operator-token', {
        proposalId: '',
        agentId: 'agent-1'
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/deploy/rollback rejects missing agentId', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/rollback', 'POST', 'operator-token', {
        targetDigest: { algorithm: 'sha256', value: 'sha256:abc123' }
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/deploy/rollback rejects missing targetDigest', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/rollback', 'POST', 'operator-token', {
        agentId: 'agent-1'
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/deploy/rollback rejects invalid digest algorithm', async () => {
      const app = createBffWithDeployCore()
      const res = await makeRequest(app, '/api/v0/deploy/rollback', 'POST', 'operator-token', {
        agentId: 'agent-1',
        targetDigest: { algorithm: 'md5', value: 'abc123' }
      })
      expect(res.status).toBe(400)
    })

    it('POST /api/v0/deploy/apply rejects malformed body', async () => {
      const app = createBffWithDeployCore()
      const headers = {
        authorization: 'Bearer operator-token',
        'content-type': 'application/json'
      }
      const res = await app.handle(
        new Request('http://localhost/api/v0/deploy/apply', {
          method: 'POST',
          headers,
          body: '{ invalid json'
        })
      )
      expect(res.status).toBe(400)
    })
  })
})
