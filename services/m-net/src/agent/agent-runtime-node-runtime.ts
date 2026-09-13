import type {
  MNetTunnelHealthFromSchema,
  NodeAgentRuntimeDesiredSidecar,
  NodeAgentRuntimeStatus
} from '../../../../packages/contracts/src/index.ts'
import type { NetworkMapFromSchema } from '../../../../packages/contracts/src/schemas/mnet-profile.ts'
import { decodeMNetProfileV03Compatibility } from '../../../../packages/contracts/src/schemas/mnet-profile-v03.ts'
import type { MNetDb } from '../clients.ts'
import type {
  ClosedLoopFailure,
  ClosedLoopMutationOutcome
} from '../closed-loop/closed-loop-workflow-types.ts'
import { fetchLatestNetworkMap } from '../data-plane/mnet-dataplane-materialize.ts'
import type {
  DataPlaneDeps,
  NodeKeyRegistrationSuccess
} from '../data-plane/mnet-dataplane-support.ts'
import { registerNodePublicKey } from '../data-plane/mnet-dataplane-workflows.ts'
import { guardLegacyNodeRuntime } from '../migration/migration-required-support.ts'
import type { ProfileWorkflowFailure } from '../profile/profile-workflow-types.ts'
import { validateNodeCredential } from './agent-runtime-session-lifecycle.ts'

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
  reportStatus(input: { nodeId: string; runtimeStatus: NodeAgentRuntimeStatus }): Promise<void>
  reportTunnelHealth(input: {
    nodeId: string
    health: Omit<MNetTunnelHealthFromSchema, 'nodeId' | 'stateSource'>
  }): Promise<
    | ClosedLoopMutationOutcome<MNetTunnelHealthFromSchema>
    | ClosedLoopFailure
    | ProfileWorkflowFailure
  >
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
  if (desiredConfig?.desiredState) return desiredConfig.desiredState
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
  reportRuntimeStatus?: (input: {
    networkId: string
    nodeId: string
    runtimeStatus: NodeAgentRuntimeStatus
  }) => Promise<void>
  reportTunnelHealth?: (input: {
    networkId: string
    nodeId: string
    health: Omit<MNetTunnelHealthFromSchema, 'nodeId' | 'stateSource'>
  }) => Promise<ClosedLoopMutationOutcome<MNetTunnelHealthFromSchema> | ClosedLoopFailure>
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
    },
    async reportStatus(payload) {
      const guard = await guardLegacyNodeRuntime(input.db, payload.nodeId)
      if ('kind' in guard) return
      await input.reportRuntimeStatus?.({
        networkId: guard.networkId,
        nodeId: payload.nodeId,
        runtimeStatus: payload.runtimeStatus
      })
    },
    async reportTunnelHealth(payload) {
      const guard = await guardLegacyNodeRuntime(input.db, payload.nodeId)
      if ('kind' in guard) return guard
      if (!input.reportTunnelHealth) {
        return {
          kind: 'failure',
          status: 503,
          error: {
            code: 'feature.unavailable',
            message: 'node tunnel health reporting is not available'
          },
          recovery: 'no_side_effect'
        }
      }
      return input.reportTunnelHealth({
        networkId: guard.networkId,
        nodeId: payload.nodeId,
        health: payload.health
      })
    }
  }
}
