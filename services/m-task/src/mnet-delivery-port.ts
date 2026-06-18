import * as Schema from 'effect/Schema'
import {
  type Result,
  err as resultErr,
  ok as resultOk
} from '../../../packages/common/src/result.ts'
import {
  ApiErrorSchema,
  type NodeAgentTaskExecuteEnvelopeResponseFromSchema,
  NodeAgentTaskExecuteEnvelopeResponseSchema
} from '../../../packages/contracts/src/index.ts'
import {
  createInternalFetcher,
  internalRequestHeaders,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import type { MTaskDeliveryPort, ServiceError } from './deps.ts'

type DeliveryPortOptions = {
  baseUrl?: string
  fetcher?: typeof fetch
}

function serviceErrorFromHttpResponse(value: unknown, fallback: ServiceError): ServiceError {
  const decoded = Schema.decodeUnknownEither(ApiErrorSchema)(value)
  if (decoded._tag === 'Left') return fallback
  return decoded.right.error
}

function decodeDispatchResponse(
  value: unknown
): Result<NodeAgentTaskExecuteEnvelopeResponseFromSchema, ServiceError> {
  const decoded = Schema.decodeUnknownEither(NodeAgentTaskExecuteEnvelopeResponseSchema)(value)
  return decoded._tag === 'Right'
    ? resultOk(decoded.right)
    : resultErr({
        code: 'dispatch.invalid_response',
        message: `M-Net returned invalid dispatch payload: ${String(decoded.left)}`
      })
}

function mapDispatchFailure(failure: ServiceError): ServiceError {
  switch (failure.code) {
    case 'node.unreachable':
      return { code: 'dispatch.offline', message: failure.message }
    case 'node.stale_session':
      return { code: 'dispatch.stale_session', message: failure.message }
    case 'node.not_found':
      return { code: 'dispatch.target_missing', message: failure.message }
    case 'node.invalid_kind':
    case 'node.invalid_status':
      return { code: 'dispatch.invalid_target', message: failure.message }
    case 'dispatch.invalid_response':
      return failure
    default:
      return { code: 'dispatch.unavailable', message: failure.message }
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * M-Task 通过 M-Net internal HTTP 投递任务；M-Net 只负责把任务送达活动 agent session。
 */
export function createHttpMNetTaskDeliveryPort(
  options: DeliveryPortOptions = {}
): MTaskDeliveryPort {
  const baseUrl = options.baseUrl ?? serviceUrl('m-net')
  const fetcher = options.fetcher ?? createInternalFetcher()

  return {
    async submitDelivery(input) {
      let response: Response
      try {
        response = await fetcher(`${baseUrl}/internal/v0/tasks/noop`, {
          method: 'POST',
          headers: internalRequestHeaders({ 'content-type': 'application/json' }),
          body: JSON.stringify(input)
        })
      } catch {
        return resultErr({
          code: 'dispatch.unavailable',
          message: 'm-net dispatch unavailable'
        })
      }

      const body = await parseJsonResponse(response)
      if (!response.ok) {
        return resultErr(
          mapDispatchFailure(
            serviceErrorFromHttpResponse(body, {
              code: 'dispatch.unavailable',
              message: 'm-net dispatch unavailable'
            })
          )
        )
      }

      const decoded = decodeDispatchResponse(body)
      if (!decoded.ok) return resultErr(mapDispatchFailure(decoded.error))

      return resultOk({ completedAt: decoded.value.result.completedAt })
    },
    async cancelDelivery() {
      return resultOk('notDeliverable')
    }
  }
}
