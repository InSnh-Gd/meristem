import { and, eq } from 'drizzle-orm'
import type { NodeAgentRuntimeDesiredSidecar } from '../../../packages/contracts/src/index.ts'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import { decodeMNetProfileV03Compatibility } from '../../../packages/contracts/src/schemas/mnet-profile-v03.ts'
import { validateNodeCredential } from './agent-runtime-session-lifecycle.ts'
import type { MNetDb } from './clients.ts'
import { guardLegacyNodeRuntime } from './migration-required-support.ts'
import { fetchLatestNetworkMap } from './mnet-dataplane-materialize.ts'
import type { DataPlaneDeps, NodeKeyRegistrationSuccess } from './mnet-dataplane-support.ts'
import { registerNodePublicKey } from './mnet-dataplane-workflows.ts'
import type { ProfileWorkflowFailure } from './profile-workflow-types.ts'

type NodeRuntimeFacade = {
  authorize(nodeId: string, token: string): Promise<boolean>
  fetchLatestNetworkMap(nodeId: string): Promise<
    | {
        map: NetworkMapFromSchema
        sidecar: NodeAgentRuntimeDesiredSidecar
      }
    | ProfileWorkflowFailure
  >
  registerNodePublicKey(input: {
    nodeId: string
    keyId: string
    publicKey: string
    createdAt: string
    endpoint?: string
  }): Promise<NodeKeyRegistrationSuccess | ProfileWorkflowFailure>
}

async function resolveSidecarRuntimeState(
  deps: DataPlaneDeps,
  networkId: string,
  nodeId: string
): Promise<NodeAgentRuntimeDesiredSidecar> {
  const network = await deps.profileStore.getNetworkState(networkId)
  const profileDefinition = network
    ? await deps.profileStore.getDefinition(network.profileVersion)
    : null

  if (!profileDefinition) {
    return {
      signalConfigRef: { configRef: 'netbird/signal/missing' },
      relayConfigRef: { configRef: 'netbird/relay/missing' },
      stunConfigRef: { configRef: 'netbird/stun/missing' },
      sidecarCredentialRef: { provider: 'missing', keyPath: 'netbird/sidecar/missing' },
      desiredState: 'stop',
      credentialStatus: 'missing',
      healthStatus: 'unknown'
    }
  }

  const compatibility = decodeMNetProfileV03Compatibility(profileDefinition)
  if (compatibility.kind !== 'profile') {
    return {
      signalConfigRef: { configRef: 'netbird/signal/migration-required' },
      relayConfigRef: { configRef: 'netbird/relay/migration-required' },
      stunConfigRef: { configRef: 'netbird/stun/migration-required' },
      sidecarCredentialRef: {
        provider: 'migration-required',
        keyPath: 'netbird/sidecar/migration-required'
      },
      desiredState: 'stop',
      credentialStatus: 'missing',
      healthStatus: 'degraded'
    }
  }

  const desiredConfig = await deps.dataPlane.sidecarDesiredConfigs.get(nodeId)
  return {
    signalConfigRef: compatibility.profile.capabilities.signalConfigRef,
    relayConfigRef: compatibility.profile.capabilities.relayConfigRef,
    stunConfigRef: compatibility.profile.capabilities.stunConfigRef,
    sidecarCredentialRef: compatibility.profile.capabilities.sidecarCredentialRef,
    desiredState: compatibility.profile.capabilities.sidecarDesiredState,
    credentialStatus: compatibility.profile.capabilities.sidecarCredentialStatus,
    healthStatus: compatibility.profile.capabilities.sidecarHealthStatus,
    ...(desiredConfig?.configHash ? { configHash: desiredConfig.configHash } : {})
  }
}
export function createNodeRuntimeFacade(input: {
  db: MNetDb
  dataPlaneDeps?: DataPlaneDeps | null
}): NodeRuntimeFacade | null {
  const dataPlaneDeps = input.dataPlaneDeps
  if (!dataPlaneDeps) return null

  return {
    authorize(nodeId, token) {
      return validateNodeCredential({ db: input.db }, nodeId, token)
    },
    async fetchLatestNetworkMap(nodeId) {
      const guard = await guardLegacyNodeRuntime(input.db, nodeId)
      if ('kind' in guard) {
        return guard
      }

      const map = await fetchLatestNetworkMap(dataPlaneDeps, guard.networkId)
      if ('kind' in map) {
        return map
      }

      return {
        map: map.map,
        sidecar: await resolveSidecarRuntimeState(dataPlaneDeps, guard.networkId, nodeId)
      }
    },
    async registerNodePublicKey(payload) {
      const guard = await guardLegacyNodeRuntime(input.db, payload.nodeId)
      if ('kind' in guard) {
        return guard
      }

      return registerNodePublicKey(dataPlaneDeps, {
        networkId: guard.networkId,
        nodeId: payload.nodeId,
        keyId: payload.keyId,
        publicKey: payload.publicKey,
        createdAt: payload.createdAt,
        ...(payload.endpoint ? { endpoint: payload.endpoint } : {})
      })
    }
  }
}
