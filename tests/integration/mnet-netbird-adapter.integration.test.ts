import { beforeEach, describe, expect, it } from 'bun:test'
import { createMNetApp } from '@m-net/app.ts'
import { createInMemoryDataPlaneStores } from '@m-net/data-plane/data-plane-store-memory.ts'
import { fetchLatestNetworkMap } from '@m-net/data-plane/mnet-dataplane-materialize.ts'
import { requireDataPlaneDeps } from '@m-net/data-plane/mnet-dataplane-support.ts'
import type { MNetAppDeps } from '@m-net/deps.ts'
import { createOperationalReadModel } from '@m-net/operational-read-model.ts'
import { createInMemoryProfileStore } from '@m-net/profile/profile-store.ts'
import { createInMemorySuspendedOperationStore } from '@m-net/suspended-operations.ts'
import type {
  ActorId,
  MNetworkMember,
  NodeAgentRuntimeStatus
} from '../../packages/contracts/src/index.ts'
import type { NetworkMapFromSchema } from '../../packages/contracts/src/schemas/mnet-profile.ts'

const bearerHeaders = {
  authorization: 'Bearer operator-token',
  'content-type': 'application/json'
}

const nodeRuntimeHeaders = {
  authorization: 'Bearer node-runtime-token',
  'content-type': 'application/json'
}

const observedAt = '2026-07-01T12:00:00.000Z'

function joinedMember(input: {
  networkId: string
  nodeId: string
  nodeKind: 'stem' | 'leaf'
}): MNetworkMember {
  return {
    networkId: input.networkId,
    nodeId: input.nodeId,
    nodeKind: input.nodeKind,
    membershipMode: 'full',
    status: 'joined',
    joinedAt: observedAt
  }
}

function observedRuntimeStatus(configHash: string): NodeAgentRuntimeStatus {
  return {
    kind: 'healthy',
    desiredState: 'start',
    credentialStatus: 'ready',
    healthStatus: 'healthy',
    configHash,
    processRef: 'netbird:stem-runtime-1',
    processPid: 4401,
    processStartedAt: observedAt,
    lastProbeAt: observedAt,
    observedHealth: 'healthy',
    correlationId: 'runtime-report-correlation-1',
    observedAt,
    dependencies: {
      signal: 'ready',
      relay: 'ready',
      stun: 'ready'
    },
    degradedReasons: []
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected object response')
  return Object.fromEntries(Object.entries(value))
}

function requireNestedObject(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return requireObject(value[key])
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`expected ${label} string`)
  return value
}

async function createHarness(input?: {
  resolveNetBirdControlPlane?: MNetAppDeps['resolveNetBirdControlPlane']
}) {
  const networkId = `mnet-netbird-runtime-${crypto.randomUUID()}`
  const members = [
    joinedMember({ networkId, nodeId: 'stem-runtime-1', nodeKind: 'stem' }),
    joinedMember({ networkId, nodeId: 'leaf-runtime-1', nodeKind: 'leaf' })
  ]
  const profileStore = createInMemoryProfileStore()
  const dataPlane = createInMemoryDataPlaneStores()
  // DFW-032：成员须持有真实运行时密钥才会进入渲染 map，否则 materialize fail closed
  // （network.no_runtime_keys）。本文件各用例均验证 enable 后的 map/sidecar 行为，
  // 故在 harness 内为所有成员注册密钥。
  for (const member of members) {
    await dataPlane.nodePublicKeys.upsert({
      nodeId: member.nodeId,
      keyId: `${member.nodeId}-runtime`,
      publicKey: `${member.nodeId
        .replace(/[^A-Za-z0-9]/g, 'A')
        .padEnd(43, 'B')
        .slice(0, 43)}=`,
      fingerprint: `fp-${member.nodeId}`,
      algorithm: 'wireguard-x25519',
      createdAt: observedAt,
      rotationCounter: 0,
      status: 'active'
    })
  }
  const listMembers: MNetAppDeps['listMembers'] = async request => ({
    ok: true,
    value: members.filter(member => member.networkId === request.networkId)
  })
  const policyAuthorize: NonNullable<MNetAppDeps['policyAuthorize']> = {
    async authorize() {
      return { result: 'allow', id: 'policy-allow-netbird-runtime', reasons: [] }
    }
  }
  const log: NonNullable<MNetAppDeps['log']> = {
    async writeTimeline() {
      /* test fixture log sink */
    },
    async writeFull() {
      /* test fixture log sink */
    },
    async writeAudit() {
      /* test fixture audit sink */
    }
  }
  const events: NonNullable<MNetAppDeps['events']> = {
    async publish() {
      /* test fixture event sink */
    }
  }
  const dataPlaneDeps = requireDataPlaneDeps({
    profileStore,
    policyAuthorize,
    listMembers,
    dataPlane,
    log,
    events,
    ...(input?.resolveNetBirdControlPlane
      ? { resolveNetBirdControlPlane: input.resolveNetBirdControlPlane }
      : {})
  })
  if ('kind' in dataPlaneDeps) throw new Error(dataPlaneDeps.error.message)

  const readModel = createOperationalReadModel({
    profileStore,
    listMembers,
    dataPlane,
    now: () => new Date(observedAt)
  })
  const nodeRuntime: NonNullable<MNetAppDeps['nodeRuntime']> = {
    async authorize(_nodeId, token) {
      return token === 'node-runtime-token'
    },
    async fetchLatestNetworkMap(nodeId) {
      const map = await fetchLatestNetworkMap(dataPlaneDeps, networkId)
      if ('kind' in map) return map
      const desired = await dataPlane.sidecarDesiredConfigs.get(nodeId)
      if (!desired?.desiredState) throw new Error(`missing desired state for ${nodeId}`)
      return { map: map.map as NetworkMapFromSchema, sidecar: desired.desiredState }
    },
    async registerNodePublicKey() {
      throw new Error('not used by this integration test')
    },
    async reportStatus(payload) {
      await readModel.ingestRuntimeStatus({
        networkId,
        nodeId: payload.nodeId,
        runtimeStatus: payload.runtimeStatus
      })
    }
  }

  const app = createMNetApp({
    auth: {
      async verify() {
        return { ok: true, actor: 'operator' as ActorId }
      }
    },
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listNetworks() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    listMembers,
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    profileStore,
    suspendedOps: createInMemorySuspendedOperationStore(),
    approvals: {
      async create() {
        return { ok: true, value: { approvalId: 'approval-netbird-runtime' } }
      }
    },
    policyAuthorize,
    events,
    log,
    dataPlane,
    nodeRuntime,
    getOperationalState: readModel.getSnapshot,
    ingestOperationalEvent: readModel.ingestEvent,
    ...(input?.resolveNetBirdControlPlane
      ? { resolveNetBirdControlPlane: input.resolveNetBirdControlPlane }
      : {})
  })

  return { app, dataPlane, networkId, profileStore }
}

describe('integration: M-Net NetBird runtime adapter', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  it('enables m-net-cn@0.3.0 with NetBird desired state and observed read-model facts', async () => {
    const { app, dataPlane, networkId, profileStore } = await createHarness({
      async resolveNetBirdControlPlane() {
        return {
          managementUrl: 'https://netbird.example.internal',
          setupKey: 'nb-setup-key-from-secret-provider',
          signalConfigRef: { configRef: 'signal/cn-primary' },
          relayConfigRef: { configRef: 'relay/cn-primary' },
          stunConfigRef: { configRef: 'stun/cn-primary' },
          sidecarCredentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/cn-sidecar',
            version: 1
          },
          prerequisites: {
            signalReady: true,
            relayReady: true,
            stunReady: true
          }
        }
      }
    })

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })

    const enableResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/profile`, {
        method: 'POST',
        headers: bearerHeaders,
        body: JSON.stringify({
          profileVersion: 'm-net-cn@0.3.0',
          reason: 'activate real NetBird adapter'
        })
      })
    )
    expect(enableResponse.status).toBe(200)

    const runtimeResponse = await app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/stem-runtime-1/network-map', {
        headers: nodeRuntimeHeaders
      })
    )
    expect(runtimeResponse.status).toBe(200)
    const runtimeBody = requireObject(await runtimeResponse.json())
    const runtimeSidecar = requireNestedObject(runtimeBody, 'sidecar')
    expect(runtimeSidecar).toMatchObject({
      managementUrl: 'https://netbird.example.internal',
      setupKey: 'nb-setup-key-from-secret-provider',
      signalConfigRef: { configRef: 'signal/cn-primary' },
      relayConfigRef: { configRef: 'relay/cn-primary' },
      stunConfigRef: { configRef: 'stun/cn-primary' },
      desiredState: 'start',
      credentialStatus: 'ready',
      healthStatus: 'healthy'
    })
    expect(requireString(runtimeSidecar.configHash, 'runtime configHash')).toMatch(/^[a-f0-9]{64}$/)

    const desired = await dataPlane.sidecarDesiredConfigs.get('stem-runtime-1')
    if (!desired?.configHash) throw new Error('expected desired config hash')
    const statusResponse = await app.handle(
      new Request('http://localhost/api/v0/node-runtime/nodes/stem-runtime-1/status', {
        method: 'POST',
        headers: nodeRuntimeHeaders,
        body: JSON.stringify(observedRuntimeStatus(desired.configHash))
      })
    )
    expect(statusResponse.status).toBe(200)

    const operationalResponse = await app.handle(
      new Request(`http://localhost/api/v0/networks/${networkId}/operational-state`, {
        headers: bearerHeaders
      })
    )
    expect(operationalResponse.status).toBe(200)
    const operationalBody = requireObject(await operationalResponse.json())
    const sidecars = operationalBody.sidecars
    if (!Array.isArray(sidecars)) throw new Error('expected operational sidecars array')
    const topology = requireNestedObject(operationalBody, 'topology')
    const topologyNodes = topology.nodes
    if (!Array.isArray(topologyNodes)) throw new Error('expected operational topology nodes array')
    expect(
      topologyNodes.map(item => requireString(requireObject(item).nodeId, 'topology nodeId'))
    ).toEqual(['stem-runtime-1', 'leaf-runtime-1'])
    expect(requireObject(topologyNodes[1])).toMatchObject({
      nodeId: 'leaf-runtime-1',
      healthStatus: 'unknown',
      state: 'migration_required'
    })
    const sidecar = sidecars
      .map(item => requireObject(item))
      .find(item => item.nodeId === 'stem-runtime-1')
    expect(sidecar).toMatchObject({
      adapterStatus: 'netbird',
      desiredConfigHash: desired.configHash,
      observedConfigHash: desired.configHash,
      desiredState: 'start',
      credentialStatus: 'ready',
      healthStatus: 'healthy'
    })
  })
})
