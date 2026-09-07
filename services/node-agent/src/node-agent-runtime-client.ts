import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import type {
  NetworkMapFromSchema,
  NodeAgentRuntimeDesiredSidecar
} from '../../../packages/contracts/src/index.ts'
import {
  MNetSidecarCredentialStatusSchema,
  MNetSidecarDesiredStateSchema,
  MNetSidecarHealthStatusSchema,
  NetworkMapSchema,
  SecretRefSchema
} from '../../../packages/contracts/src/index.ts'

/**
 * Node runtime HTTP 客户端：URL 推导、Effect Schema 解码与 fetch 编排。
 * 只与 node-runtime REST 端点交互，不持有会话状态；结果以 tagged union 返回给调用方。
 */

export type RuntimeKeyRegistrationInput = {
  keyId: string
  publicKey: string
  createdAt: string
  /** 节点的公网 WireGuard 端点（STUN 发现），用于直接 P2P 连接。 */
  endpoint?: string
}

export type RuntimeKeyRegistrationResult =
  | {
      kind: 'runtime.key.registered'
      nodeId: string
      keyId: string
      fingerprint: string
      mapVersion: number
      correlationId: string
    }
  | {
      kind: 'runtime.request_failed'
      reason: string
    }

export type RuntimeNetworkMapResult =
  | {
      kind: 'runtime.network_map.fetched'
      map: NetworkMapFromSchema
      sidecar: NodeAgentRuntimeDesiredSidecar
    }
  | {
      kind: 'runtime.request_failed'
      reason: string
    }

type RuntimeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const NodeRuntimeKeyRegistrationResponseSchema = Schema.Struct({
  nodeId: Schema.NonEmptyString,
  keyId: Schema.NonEmptyString,
  fingerprint: Schema.NonEmptyString,
  mapVersion: Schema.Number.check(Schema.isGreaterThanOrEqualTo(1)),
  correlationId: Schema.NonEmptyString
})

const NodeRuntimeNetworkMapResponseSchema = Schema.Struct({
  map: NetworkMapSchema,
  sidecar: Schema.Struct({
    signalConfigRef: Schema.Struct({ configRef: Schema.String }),
    relayConfigRef: Schema.Struct({ configRef: Schema.String }),
    stunConfigRef: Schema.Struct({ configRef: Schema.String }),
    sidecarCredentialRef: SecretRefSchema,
    desiredState: MNetSidecarDesiredStateSchema,
    credentialStatus: MNetSidecarCredentialStatusSchema,
    healthStatus: MNetSidecarHealthStatusSchema,
    configHash: Schema.optional(Schema.String)
  })
})

const decodeNodeRuntimeKeyRegistrationResponse = Schema.decodeUnknownResult(
  NodeRuntimeKeyRegistrationResponseSchema
)
const decodeNodeRuntimeNetworkMapResponse = Schema.decodeUnknownResult(
  NodeRuntimeNetworkMapResponseSchema
)

const NodeTunnelStatusResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  nodeId: Schema.NonEmptyString,
  publishStatus: Schema.Literals(['published', 'degraded']),
  correlationId: Schema.NonEmptyString
})

function normalizeDesiredSidecar(payload: {
  signalConfigRef: { configRef: string }
  relayConfigRef: { configRef: string }
  stunConfigRef: { configRef: string }
  sidecarCredentialRef: NodeAgentRuntimeDesiredSidecar['sidecarCredentialRef']
  desiredState: NodeAgentRuntimeDesiredSidecar['desiredState']
  credentialStatus: NodeAgentRuntimeDesiredSidecar['credentialStatus']
  healthStatus: NodeAgentRuntimeDesiredSidecar['healthStatus']
  configHash?: string | undefined
}): NodeAgentRuntimeDesiredSidecar {
  return {
    signalConfigRef: payload.signalConfigRef,
    relayConfigRef: payload.relayConfigRef,
    stunConfigRef: payload.stunConfigRef,
    sidecarCredentialRef: payload.sidecarCredentialRef,
    desiredState: payload.desiredState,
    credentialStatus: payload.credentialStatus,
    healthStatus: payload.healthStatus,
    ...(typeof payload.configHash === 'string' ? { configHash: payload.configHash } : {})
  }
}

export function deriveControlUrl(joinUrl: string): string | null {
  try {
    const parsed = new URL(joinUrl)
    const controlProtocol =
      parsed.protocol === 'wss:' || parsed.protocol === 'https:' ? 'https:' : 'http:'
    parsed.protocol = controlProtocol
    parsed.port = '3104'
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function createNodeRuntimeUrl(
  controlUrl: string,
  nodeId: string,
  suffix: 'key' | 'network-map' | 'tunnel-status' | 'leave'
): URL {
  const url = new URL(
    `/api/v0/node-runtime/nodes/${encodeURIComponent(nodeId)}/${suffix}`,
    controlUrl.endsWith('/') ? controlUrl : `${controlUrl}/`
  )
  return url
}

async function parseRuntimeFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    const message = payload.error?.message
    if (typeof message === 'string' && message.trim().length > 0) {
      return message
    }
  } catch {
    // ignored: fall through to generic status reason
  }

  return `runtime request failed with status ${response.status}`
}

export async function registerNodeRuntimeKey(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  input: RuntimeKeyRegistrationInput,
  fetchImpl: RuntimeFetch = fetch
): Promise<RuntimeKeyRegistrationResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'key'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${nodeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(input)
    })

    if (!response.ok) {
      return { kind: 'runtime.request_failed', reason: await parseRuntimeFailure(response) }
    }

    const payload = decodeNodeRuntimeKeyRegistrationResponse(await response.json())
    if (Result.isFailure(payload)) {
      return {
        kind: 'runtime.request_failed',
        reason: 'runtime key registration response is invalid'
      }
    }

    return { kind: 'runtime.key.registered', ...payload.success }
  } catch (error) {
    return {
      kind: 'runtime.request_failed',
      reason: error instanceof Error ? error.message : 'runtime key registration failed'
    }
  }
}

export async function fetchLatestNodeRuntimeNetworkMap(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  fetchImpl: RuntimeFetch = fetch
): Promise<RuntimeNetworkMapResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'network-map'), {
      headers: {
        authorization: `Bearer ${nodeToken}`
      }
    })

    if (!response.ok) {
      return { kind: 'runtime.request_failed', reason: await parseRuntimeFailure(response) }
    }

    const payload = decodeNodeRuntimeNetworkMapResponse(await response.json())
    if (Result.isFailure(payload)) {
      return { kind: 'runtime.request_failed', reason: 'runtime network-map response is invalid' }
    }

    return {
      kind: 'runtime.network_map.fetched',
      map: payload.success.map,
      sidecar: normalizeDesiredSidecar(payload.success.sidecar)
    }
  } catch (error) {
    return {
      kind: 'runtime.request_failed',
      reason: error instanceof Error ? error.message : 'runtime network-map fetch failed'
    }
  }
}

/** 节点隧道状态上报载荷，与 M-Net tunnel-status 路由契约对齐。 */
export type NodeTunnelStatusReport = {
  networkId: string
  profileVersion: string
  healthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  previousHealthStatus: 'unknown' | 'healthy' | 'degraded' | 'unhealthy'
  signalReachable: boolean
  relayReachable: boolean
  stunReachable: boolean
  checkedAt: string
}

export type NodeTunnelStatusReportResult =
  | {
      kind: 'tunnel_status.reported'
      nodeId: string
      publishStatus: 'published' | 'degraded'
      correlationId: string
    }
  | {
      kind: 'runtime.request_failed'
      reason: string
    }

export async function reportNodeTunnelStatus(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  report: NodeTunnelStatusReport,
  fetchImpl: RuntimeFetch = fetch
): Promise<NodeTunnelStatusReportResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'tunnel-status'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${nodeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(report)
    })

    if (!response.ok) {
      return { kind: 'runtime.request_failed', reason: await parseRuntimeFailure(response) }
    }

    const payload = Schema.decodeUnknownSync(NodeTunnelStatusResponseSchema)(await response.json())
    return {
      kind: 'tunnel_status.reported',
      nodeId: payload.nodeId,
      publishStatus: payload.publishStatus,
      correlationId: payload.correlationId
    }
  } catch (error) {
    return {
      kind: 'runtime.request_failed',
      reason: error instanceof Error ? error.message : 'tunnel status report failed'
    }
  }
}

export type NodeLeaveResult =
  | { kind: 'node.leave'; networkId: string; nodeId: string }
  | { kind: 'runtime.request_failed'; reason: string }

/** 节点主动退出：通知 M-Net 移除成员关系；404（本就不是成员）按幂等成功处理。 */
export async function leaveNetwork(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  networkId: string,
  fetchImpl: RuntimeFetch = fetch
): Promise<NodeLeaveResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'leave'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${nodeToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ networkId })
    })
    if (response.status === 404) {
      return { kind: 'node.leave', networkId, nodeId }
    }
    if (!response.ok) {
      return { kind: 'runtime.request_failed', reason: await parseRuntimeFailure(response) }
    }
    const payload = (await response.json()) as { left?: boolean; networkId?: string }
    if (payload.left !== true) {
      return { kind: 'runtime.request_failed', reason: 'node leave response is invalid' }
    }
    return { kind: 'node.leave', networkId, nodeId }
  } catch (error) {
    return {
      kind: 'runtime.request_failed',
      reason: error instanceof Error ? error.message : 'node leave request failed'
    }
  }
}
