import { describe, expect, it } from 'bun:test'
import type { MNetworkMember } from '../../packages/contracts/src/index.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import { enableDataPlaneProfile } from '../../services/m-net/src/mnet-dataplane-workflows.ts'
import { requireDataPlaneDeps } from '../../services/m-net/src/mnet-dataplane-support.ts'
import { createOperationalReadModel } from '../../services/m-net/src/operational-read-model.ts'
import { createInMemoryProfileStore } from '../../services/m-net/src/profile-store.ts'

const networkId = 'mnet-netbird-missing-secret-provider'
const nodeId = 'stem-missing-secret-provider'
const observedAt = '2026-07-01T13:00:00.000Z'

function joinedMember(): MNetworkMember {
  return {
    networkId,
    nodeId,
    nodeKind: 'stem',
    membershipMode: 'full',
    status: 'joined',
    joinedAt: observedAt
  }
}

describe('failure mode: M-Net NetBird adapter activation', () => {
  it('records degraded operational state when SecretProvider control-plane material is missing', async () => {
    process.env.NODE_ENV = 'test'
    const profileStore = createInMemoryProfileStore()
    const dataPlane = createInMemoryDataPlaneStores()
    const listMembers = async () => ({ ok: true as const, value: [joinedMember()] })
    const policyAuthorize = {
      async authorize() {
        return { result: 'allow' as const, id: 'policy-allow-missing-secret', reasons: [] }
      }
    }
    const log = {
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
    const deps = requireDataPlaneDeps({
      profileStore,
      policyAuthorize,
      listMembers,
      dataPlane,
      log
    })
    if ('kind' in deps) throw new Error(deps.error.message)

    await profileStore.setNetworkState(networkId, {
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })

    // DFW-032：成员须持有真实运行时密钥才会进入渲染 map，否则 materialize fail closed
    // （network.no_runtime_keys）。本用例关注 adapter 降级，故先注册密钥。
    await dataPlane.nodePublicKeys.upsert({
      nodeId,
      keyId: `${nodeId}-runtime`,
      publicKey: `${nodeId
        .replace(/[^A-Za-z0-9]/g, 'A')
        .padEnd(43, 'B')
        .slice(0, 43)}=`,
      fingerprint: `fp-${nodeId}`,
      algorithm: 'wireguard-x25519',
      createdAt: new Date().toISOString(),
      rotationCounter: 0,
      status: 'active'
    })

    const result = await enableDataPlaneProfile(deps, {
      actor: 'operator',
      networkId,
      reason: 'missing SecretProvider failure path',
      profileVersion: 'm-net@0.3.0'
    })

    expect('kind' in result ? result.error.code : '').toBe('netbird.config.missing_control_plane')
    const desired = await dataPlane.sidecarDesiredConfigs.get(nodeId)
    expect(desired).toMatchObject({
      adapterStatus: 'degraded',
      degradedReason: {
        code: 'netbird.config.missing_control_plane'
      }
    })

    const readModel = createOperationalReadModel({
      profileStore,
      listMembers,
      dataPlane,
      now: () => new Date(observedAt)
    })
    const snapshot = await readModel.getSnapshot(networkId)
    if ('kind' in snapshot) throw new Error(snapshot.error.message)
    const sidecar = snapshot.sidecars.find(item => item.nodeId === nodeId)
    expect(sidecar).toMatchObject({
      adapterStatus: 'degraded',
      desiredConfigHash: `${networkId}:m-net@0.3.0:netbird-degraded`,
      credentialStatus: 'missing'
    })
  })
})
