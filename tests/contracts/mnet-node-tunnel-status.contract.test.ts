import { describe, expect, it } from 'bun:test'
import { createMNetApp } from '@m-net/app.ts'
import type { MNetAppDeps } from '@m-net/deps.ts'
import type { MNetOperationalEventIngestRequestFromSchema } from '../../packages/contracts/src/index.ts'
import type { ActorId } from '../../packages/contracts/src/literals.ts'
import {
  createTunnelStatusReporter,
  deriveSidecarHealthStatus,
  parseEndpointHostPort
} from '../../services/node-agent/src/node-agent-tunnel-status.ts'

const nodeRuntimeToken = 'node-runtime-token'

type IngestRecord = MNetOperationalEventIngestRequestFromSchema

function createApp(options: { withoutIngest?: boolean } = {}): {
  app: ReturnType<typeof createMNetApp>
  ingested: IngestRecord[]
} {
  const ingested: IngestRecord[] = []
  const deps: MNetAppDeps = {
    auth: {
      async verify() {
        return { ok: true as const, actor: 'operator' as ActorId }
      }
    },
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return {
        ok: false as const,
        error: { code: 'test.not_implemented', message: 'not implemented' }
      }
    },
    async listNetworks() {
      return { ok: true as const, value: [] }
    },
    async joinNetwork() {
      return {
        ok: false as const,
        error: { code: 'test.not_implemented', message: 'not implemented' }
      }
    },
    async listMembers() {
      return { ok: true as const, value: [] }
    },
    async executeNoop() {
      return {
        ok: false as const,
        error: { code: 'test.not_implemented', message: 'not implemented' }
      }
    },
    nodeRuntime: {
      async authorize(_nodeId, token) {
        return token === nodeRuntimeToken
      },
      async fetchLatestNetworkMap(_nodeId) {
        return {
          kind: 'failure' as const,
          ok: false as const,
          status: 404 as const,
          error: { code: 'network_map.not_found', message: 'network map not found' }
        }
      },
      async registerNodePublicKey(_input) {
        return {
          kind: 'failure' as const,
          ok: false as const,
          status: 404 as const,
          error: { code: 'node.not_found', message: 'node not found' }
        }
      }
    },
    ...(options.withoutIngest
      ? {}
      : {
          async ingestOperationalEvent(input: IngestRecord) {
            ingested.push(input)
            return {
              accepted: true as const,
              networkId: input.networkId,
              publishStatus: 'published' as const,
              snapshotStatus: 'healthy' as const,
              occurredAt: '2026-09-07T00:00:00.000Z'
            }
          }
        })
  }
  return { app: createMNetApp(deps), ingested }
}

function tunnelStatusBody(overrides: Record<string, unknown> = {}) {
  return {
    networkId: 'network-cn-001',
    profileVersion: 'm-net-cn@0.3.0',
    healthStatus: 'healthy',
    previousHealthStatus: 'unknown',
    signalReachable: true,
    relayReachable: true,
    stunReachable: false,
    checkedAt: '2026-09-07T00:00:00.000Z',
    ...overrides
  }
}

describe('M-Net node runtime tunnel-status route', () => {
  it('ingests a node tunnel status report as a sidecar health operational event', async () => {
    const { app, ingested } = createApp()
    const res = await app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-1/tunnel-status', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${nodeRuntimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(tunnelStatusBody())
      })
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { accepted: boolean; nodeId: string }
    expect(body).toMatchObject({ accepted: true, nodeId: 'leaf-1' })
    expect(ingested).toHaveLength(1)
    expect(ingested[0]?.networkId).toBe('network-cn-001')
    expect(ingested[0]?.event.subject).toBe('mnet.sidecar.health.v0')
    expect(ingested[0]?.event.payload).toMatchObject({
      nodeId: 'leaf-1',
      healthStatus: 'healthy',
      stunReachable: false
    })
  })

  it('rejects reports without a valid node runtime token', async () => {
    const { app, ingested } = createApp()
    const res = await app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-1/tunnel-status', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(tunnelStatusBody())
      })
    )
    expect(res.status).toBe(401)
    expect(ingested).toHaveLength(0)
  })

  it('returns 503 when operational event ingestion is unavailable', async () => {
    const { app } = createApp({ withoutIngest: true })
    const res = await app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-1/tunnel-status', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${nodeRuntimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(tunnelStatusBody())
      })
    )
    expect(res.status).toBe(503)
  })

  it('rejects profile versions outside the operational event contract', async () => {
    const { app, ingested } = createApp()
    const res = await app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/leaf-1/tunnel-status', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${nodeRuntimeToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(tunnelStatusBody({ profileVersion: 'm-net@9.9.9' }))
      })
    )
    expect(res.status).toBe(422)
    expect(ingested).toHaveLength(0)
  })
})

describe('sidecar health status derivation', () => {
  const base = {
    enforcementStatus: 'applied' as const,
    sidecarRuntimeStatusKind: 'healthy' as const
  }

  it('reports healthy only when overlay applied and sidecar healthy', () => {
    expect(deriveSidecarHealthStatus(base)).toBe('healthy')
    expect(deriveSidecarHealthStatus({ ...base, supervisorStateKind: 'running' })).toBe('healthy')
  })

  it('reports unhealthy on fail-closed enforcement, stopped sidecar, or gave-up supervisor', () => {
    expect(deriveSidecarHealthStatus({ ...base, enforcementStatus: 'fail_closed' })).toBe(
      'unhealthy'
    )
    expect(deriveSidecarHealthStatus({ ...base, sidecarRuntimeStatusKind: 'stopped' })).toBe(
      'unhealthy'
    )
    expect(deriveSidecarHealthStatus({ ...base, supervisorStateKind: 'gave_up' })).toBe('unhealthy')
  })

  it('reports degraded for stale maps, starting sidecars, or crashed supervisors', () => {
    expect(deriveSidecarHealthStatus({ ...base, enforcementStatus: 'stale' })).toBe('degraded')
    expect(deriveSidecarHealthStatus({ ...base, sidecarRuntimeStatusKind: 'starting' })).toBe(
      'degraded'
    )
    expect(deriveSidecarHealthStatus({ ...base, supervisorStateKind: 'crashed' })).toBe('degraded')
    expect(deriveSidecarHealthStatus({ ...base, supervisorStateKind: 'recovering' })).toBe(
      'degraded'
    )
  })

  it('returns unknown when no sidecar supervisor is configured and state has not converged', () => {
    expect(deriveSidecarHealthStatus({ ...base, sidecarRuntimeStatusKind: 'starting' })).toBe(
      'degraded'
    )
    expect(deriveSidecarHealthStatus({ ...base, enforcementStatus: 'idle' })).toBe('unknown')
  })
})

describe('endpoint reachability parsing', () => {
  it('parses host:port and scheme-prefixed endpoints', () => {
    expect(parseEndpointHostPort('signal.example:10000')).toEqual({
      hostname: 'signal.example',
      port: 10000
    })
    expect(parseEndpointHostPort('rels://relay.example:443')).toEqual({
      hostname: 'relay.example',
      port: 443
    })
    expect(parseEndpointHostPort('stun.example:3478?x=1')).toEqual({
      hostname: 'stun.example',
      port: 3478
    })
  })

  it('rejects endpoints without a usable host or port', () => {
    expect(parseEndpointHostPort('')).toBeNull()
    expect(parseEndpointHostPort('no-port-here')).toBeNull()
    expect(parseEndpointHostPort('host:99999')).toBeNull()
  })
})

describe('tunnel status reporter loop', () => {
  it('skips reporting until network map facts are available', async () => {
    let probes = 0
    const reporter = createTunnelStatusReporter({
      nodeId: () => 'leaf-1',
      controlUrl: () => null,
      nodeToken: () => 'token',
      networkId: () => null,
      profileVersion: () => null,
      observation: () => ({
        enforcementStatus: 'applied',
        sidecarRuntimeStatusKind: 'healthy'
      }),
      probeEndpoint: async () => {
        probes += 1
        return true
      }
    })
    const report = await reporter.reportOnce()
    expect(report).toBeNull()
    expect(probes).toBe(0)
  })
})
