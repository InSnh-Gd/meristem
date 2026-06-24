import { and, eq } from 'drizzle-orm'
import type { NetworkMapFromSchema } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import { networkMemberships } from '../../../packages/db/src/schema.ts'
import { validateNodeCredential } from './agent-runtime-session-lifecycle.ts'
import type { MNetDb } from './clients.ts'
import { fetchLatestNetworkMap } from './mnet-dataplane-materialize.ts'
import type { DataPlaneDeps, NodeKeyRegistrationSuccess } from './mnet-dataplane-support.ts'
import { registerNodePublicKey } from './mnet-dataplane-workflows.ts'
import { type ProfileWorkflowFailure, profileWorkflowFailure } from './profile-workflow-types.ts'

type NodeRuntimeFacade = {
  authorize(nodeId: string, token: string): Promise<boolean>
  fetchLatestNetworkMap(
    nodeId: string
  ): Promise<{ map: NetworkMapFromSchema } | ProfileWorkflowFailure>
  registerNodePublicKey(input: {
    nodeId: string
    keyId: string
    publicKey: string
    createdAt: string
    endpoint?: string
  }): Promise<NodeKeyRegistrationSuccess | ProfileWorkflowFailure>
}

async function resolveJoinedNetworkId(db: MNetDb, nodeId: string): Promise<string | null> {
  const [membership] = await db
    .select({ networkId: networkMemberships.networkId })
    .from(networkMemberships)
    .where(and(eq(networkMemberships.nodeId, nodeId), eq(networkMemberships.status, 'joined')))
    .limit(1)

  return membership?.networkId ?? null
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
      const networkId = await resolveJoinedNetworkId(input.db, nodeId)
      if (!networkId) {
        return profileWorkflowFailure(404, 'node.not_in_network', 'node is not joined to a network')
      }

      return fetchLatestNetworkMap(dataPlaneDeps, networkId)
    },
    async registerNodePublicKey(payload) {
      const networkId = await resolveJoinedNetworkId(input.db, payload.nodeId)
      if (!networkId) {
        return profileWorkflowFailure(404, 'node.not_in_network', 'node is not joined to a network')
      }

      return registerNodePublicKey(dataPlaneDeps, {
        networkId,
        nodeId: payload.nodeId,
        keyId: payload.keyId,
        publicKey: payload.publicKey,
        createdAt: payload.createdAt,
        ...(payload.endpoint ? { endpoint: payload.endpoint } : {})
      })
    }
  }
}
