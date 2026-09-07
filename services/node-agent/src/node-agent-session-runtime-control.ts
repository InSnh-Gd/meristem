import { Result } from 'effect'
import * as Schema from 'effect/Schema'
import type { NodeAgentRuntimeDesiredSidecar } from '../../../packages/contracts/src/index.ts'
import {
  MNetSidecarCredentialStatusSchema,
  MNetSidecarDesiredStateSchema,
  MNetSidecarHealthStatusSchema,
  NetworkMapSchema,
  SecretRefSchema
} from '../../../packages/contracts/src/index.ts'
import type {
  RuntimeKeyRegistrationInput,
  RuntimeKeyRegistrationResult,
  RuntimeNetworkMapResult
} from './node-agent-session-contracts.ts'

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

const decodeNodeRuntimeKeyRegistrationResponse = Schema.decodeUnknownResult(NodeRuntimeKeyRegistrationResponseSchema)
const decodeNodeRuntimeNetworkMapResponse = Schema.decodeUnknownResult(NodeRuntimeNetworkMapResponseSchema)

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

/** 从 Join ingress 地址推导节点运行时控制面地址；无效 URL 必须显式拒绝。 */
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
  suffix: 'key' | 'network-map'
): URL {
  return new URL(
    `/api/v0/node-runtime/nodes/${encodeURIComponent(nodeId)}/${suffix}`,
    controlUrl.endsWith('/') ? controlUrl : `${controlUrl}/`
  )
}

async function parseRuntimeFailure(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { code?: unknown; message?: unknown } }
    const message = payload.error?.message
    if (typeof message === 'string' && message.trim().length > 0) return message
  } catch {
    // 失败响应无法解码时不信任原始载荷，统一收敛为状态码原因。
  }
  return `runtime request failed with status ${response.status}`
}

/** 注册节点 WireGuard 公钥，并对 HTTP 与响应 schema 失败返回 typed result。 */
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
      headers: { authorization: `Bearer ${nodeToken}`, 'content-type': 'application/json' },
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

/** 获取并 schema 校验最新签名网络图，拒绝任何不完整的控制面响应。 */
export async function fetchLatestNodeRuntimeNetworkMap(
  controlUrl: string,
  nodeId: string,
  nodeToken: string,
  fetchImpl: RuntimeFetch = fetch
): Promise<RuntimeNetworkMapResult> {
  try {
    const response = await fetchImpl(createNodeRuntimeUrl(controlUrl, nodeId, 'network-map'), {
      headers: { authorization: `Bearer ${nodeToken}` }
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
