import type {
  CreateNetworkResponse,
  CreateNodeTicketResponse,
  IssueNodeCredentialResponse,
  JoinNetworkResponse,
  RegisterNodeResponse
} from '../../../../packages/contracts/src/index.ts'
import type { CliClient } from '../commands/types.ts'
import type { CliRuntime } from './runtime.ts'
import { unwrap } from './shared.ts'

/**
 * 节点和网络客户端保留 Eden 动态路由访问方式，确保现有不可枚举子路由行为不变。
 */
export function createNodeNetworkClient(
  runtime: CliRuntime
): Pick<
  CliClient,
  | 'registerNode'
  | 'createNodeTicket'
  | 'issueNodeToken'
  | 'listNodes'
  | 'createNetwork'
  | 'listNetworks'
  | 'joinNetwork'
  | 'listNetworkMembers'
> {
  const { client, headers, networkRoutes, nodeRoutes } = runtime

  return {
    registerNode: async input =>
      unwrap<RegisterNodeResponse>(client.api.v0.nodes.post({ ...input, $headers: headers })),
    createNodeTicket: async input =>
      unwrap<CreateNodeTicketResponse>(
        client.api.v0['node-tickets'].post({ ...input, $headers: headers })
      ),
    issueNodeToken: async nodeId => {
      const route = nodeRoutes[nodeId]
      if (!route) throw new Error('node route unavailable')
      return unwrap<IssueNodeCredentialResponse>(route.credentials.post({ $headers: headers }))
    },
    listNodes: async (): Promise<unknown> => unwrap(client.api.v0.nodes.get({ $headers: headers })),
    createNetwork: async input =>
      unwrap<CreateNetworkResponse>(client.api.v0.networks.post({ ...input, $headers: headers })),
    listNetworks: async (): Promise<unknown> =>
      unwrap(client.api.v0.networks.get({ $headers: headers })),
    joinNetwork: async input => {
      const route = networkRoutes[input.networkId]
      if (!route) throw new Error('network route unavailable')
      return unwrap<JoinNetworkResponse>(
        route.members.post({ nodeId: input.nodeId, $headers: headers })
      )
    },
    listNetworkMembers: async networkId => {
      const route = networkRoutes[networkId]
      if (!route) throw new Error('network route unavailable')
      return unwrap(route.members.get({ $headers: headers }))
    }
  }
}
