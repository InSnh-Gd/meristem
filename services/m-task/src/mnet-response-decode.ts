import { Effect, Either } from 'effect'
import * as Schema from 'effect/Schema'
import {
  type NodeAgentTaskExecuteEnvelopeResponseFromSchema,
  NodeAgentTaskExecuteEnvelopeResponseSchema
} from '../../../packages/contracts/src/index.ts'

type DispatchDecodeFailure = {
  code: 'dispatch.invalid_response'
  message: string
}

function invalidDispatchResponse(details: string): DispatchDecodeFailure {
  return {
    code: 'dispatch.invalid_response',
    message: `M-Net returned invalid dispatch payload: ${details}`
  }
}

/**
 * M-Task 进入跨服务响应之前必须先做 Schema 解码，避免非法 payload 污染任务生命周期判断。
 */
export function decodeMNetNoopDispatchResponse(
  value: unknown
): Effect.Effect<NodeAgentTaskExecuteEnvelopeResponseFromSchema, DispatchDecodeFailure> {
  const decoded = Schema.decodeUnknownEither(NodeAgentTaskExecuteEnvelopeResponseSchema)(value)
  return Either.isRight(decoded)
    ? Effect.succeed(decoded.right)
    : Effect.fail(invalidDispatchResponse(String(decoded.left)))
}
