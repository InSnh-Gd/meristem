import { Effect, Either } from 'effect'
import * as Schema from 'effect/Schema'
import {
  type NetworkMemberRecordResponseFromSchema,
  NetworkMemberRecordResponseSchema,
  type NetworkListResponseFromSchema,
  NetworkListResponseSchema,
  type NetworkMembersResponseFromSchema,
  NetworkMembersResponseSchema,
  type NetworkRecordResponseFromSchema,
  NetworkRecordResponseSchema,
  type NodeControlResponseFromSchema,
  NodeControlResponseSchema,
  type NodeAgentTaskExecuteEnvelopeResponseFromSchema,
  NodeAgentTaskExecuteEnvelopeResponseSchema
} from '../../../../packages/contracts/src/index.ts'

type DecodeFailure = {
  code: string
  message: string
}

const invalidMNetResponseFailure = (details: string): DecodeFailure => ({
  code: 'mnet.invalid_response',
  message: `M-Net returned invalid response payload: ${details}`
})

const invalidNodeAgentResponseFailure = (details: string): DecodeFailure => ({
  code: 'nodeagent.invalid_response',
  message: `M-Net task adapter returned invalid response payload: ${details}`
})

/**
 * 跨服务 HTTP 响应在进入 Core 之前必须经过共享契约校验，
 * 不能依赖 Eden 推断或原始断言把非法 payload 混入控制面。
 */
function decodeBoundaryPayload<T>(
  schema: Schema.Schema<T>,
  value: unknown,
  createFailure: (details: string) => DecodeFailure
): Effect.Effect<T, DecodeFailure> {
  const decoded = Schema.decodeUnknownEither(schema)(value)
  return Either.isRight(decoded)
    ? Effect.succeed(decoded.right)
    : Effect.fail(createFailure(String(decoded.left)))
}

/**
 * 解码 Core -> M-Net 创建网络响应。
 */
export function decodeMNetCreateNetworkResponse(
  value: unknown
): Effect.Effect<NetworkRecordResponseFromSchema, DecodeFailure> {
  return decodeBoundaryPayload(NetworkRecordResponseSchema, value, invalidMNetResponseFailure)
}

/**
 * 解码 Core -> M-Net 网络列表响应。
 */
export function decodeMNetNetworkListResponse(
  value: unknown
): Effect.Effect<NetworkListResponseFromSchema, DecodeFailure> {
  return decodeBoundaryPayload(NetworkListResponseSchema, value, invalidMNetResponseFailure)
}

/**
 * 解码 Core -> M-Net 加入网络响应。
 */
export function decodeMNetJoinNetworkResponse(
  value: unknown
): Effect.Effect<NetworkMemberRecordResponseFromSchema, DecodeFailure> {
  return decodeBoundaryPayload(NetworkMemberRecordResponseSchema, value, invalidMNetResponseFailure)
}

/**
 * 解码 Core -> M-Net 网络成员列表响应。
 */
export function decodeMNetNetworkMembersResponse(
  value: unknown
): Effect.Effect<NetworkMembersResponseFromSchema, DecodeFailure> {
  return decodeBoundaryPayload(NetworkMembersResponseSchema, value, invalidMNetResponseFailure)
}

/**
 * 解码 Core facade -> M-Net 节点控制响应。
 */
export function decodeMNetNodeControlResponse(
  value: unknown
): Effect.Effect<NodeControlResponseFromSchema, DecodeFailure> {
  return decodeBoundaryPayload(NodeControlResponseSchema, value, invalidMNetResponseFailure)
}

/**
 * 解码 M-Task 经由 Core -> M-Net 的 noop 执行响应。
 */
export function decodeMNetNoopTaskResponse(
  value: unknown
): Effect.Effect<NodeAgentTaskExecuteEnvelopeResponseFromSchema, DecodeFailure> {
  return decodeBoundaryPayload(
    NodeAgentTaskExecuteEnvelopeResponseSchema,
    value,
    invalidNodeAgentResponseFailure
  )
}
