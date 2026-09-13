import * as Schema from 'effect/Schema'
import { err, ok } from '../../../../packages/common/src/result.ts'
import {
  MDeployAgentsResponseSchema,
  MDeployApprovalResponseSchema,
  MDeployApplyOperationResponseSchema,
  MDeployDesiredStateSummaryV01Schema,
  MDeployDriftCheckResponseSchema,
  MDeployDriftResponseSchema,
  MDeployEvidenceResponseSchema,
  MDeployProposalResponseSchema,
  MDeployRollbackOperationResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import { serviceErrorFromHttpResponse } from '../effect-helpers.ts'
import type { FacadeServiceResult } from '../routes/facade/facade-support.ts'
import type { MDeployFacadeContext, MDeployFacadePort } from '../types/mdeploy-facade.ts'

type MDeployFacadeAdapterOptions = {
  baseUrl?: string
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

type RawOutcome =
  | { kind: 'ok'; parsed: unknown }
  | { kind: 'http404' }
  | { kind: 'error'; parsed: unknown }
  | { kind: 'fetchFailed' }

function requestHeaders(context: MDeployFacadeContext): Record<string, string> {
  return {
    authorization: `Bearer ${context.bearerToken}`,
    'content-type': 'application/json',
    'x-correlation-id': context.correlationId
  }
}

/** 解析下游 JSON 正文；非 JSON 或空体返回 null，由解码层转换为类型化失败。 */
async function fetchJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * 跨服务边界解码：M-Deploy 公开响应必须通过 Effect Schema 验证后才能进入 Core。
 * 解码失败返回类型化上游错误，而不是把未验证数据透传出去。
 */
function decodeOrFailure<TSchema extends Schema.Codec<unknown>>(
  schema: TSchema,
  value: unknown,
  context: MDeployFacadeContext
): FacadeServiceResult<TSchema['Type']> {
  try {
    return ok(Schema.decodeUnknownSync(schema)(value))
  } catch {
    return err({
      code: 'm-deploy.invalid_response',
      message: `M-Deploy public API returned an invalid response (correlationId: ${context.correlationId})`
    })
  }
}

async function fetchRaw(
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  url: string,
  method: 'GET' | 'POST',
  context: MDeployFacadeContext,
  body: unknown
): Promise<RawOutcome> {
  try {
    const response = await fetcher(url, {
      method,
      headers: requestHeaders(context),
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
    })
    const parsed = await fetchJsonResponse(response)
    if (!response.ok) {
      return response.status === 404 ? { kind: 'http404' } : { kind: 'error', parsed }
    }
    return { kind: 'ok', parsed }
  } catch {
    return { kind: 'fetchFailed' }
  }
}

const unavailableError = {
  code: 'm-deploy.unavailable',
  message: 'M-Deploy public API unavailable'
}
const notFoundError = { code: 'deploy.not_found', message: 'deployment resource not found' }

function mapFailure(
  outcome: RawOutcome,
  notFoundAsNull: boolean
): FacadeServiceResult<never> | 'http404-as-null' | 'not-found' {
  if (outcome.kind === 'http404') return notFoundAsNull ? 'http404-as-null' : 'not-found'
  if (outcome.kind === 'error') {
    return err(
      serviceErrorFromHttpResponse(outcome.parsed, 'm-deploy.unavailable', unavailableError.message)
    )
  }
  return err(unavailableError)
}

/** 普通端点：下游 404 一律是类型化 not_found 错误。 */
async function sendJson<T>(
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  url: string,
  method: 'GET' | 'POST',
  context: MDeployFacadeContext,
  body: unknown,
  decode: (value: unknown) => FacadeServiceResult<T>
): Promise<FacadeServiceResult<T>> {
  const outcome = await fetchRaw(fetcher, url, method, context, body)
  if (outcome.kind !== 'ok') {
    const mapped = mapFailure(outcome, false)
    if (mapped === 'http404-as-null' || mapped === 'not-found') return err(notFoundError)
    return mapped
  }
  return decode(outcome.parsed)
}

/** 详情查找端点：下游 404 映射为 null，交由路由层转换为公开 404。 */
async function sendJsonNullable<T>(
  fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
  url: string,
  method: 'GET' | 'POST',
  context: MDeployFacadeContext,
  body: unknown,
  decode: (value: unknown) => FacadeServiceResult<T>
): Promise<FacadeServiceResult<T | null>> {
  const outcome = await fetchRaw(fetcher, url, method, context, body)
  if (outcome.kind !== 'ok') {
    const mapped = mapFailure(outcome, true)
    if (mapped === 'http404-as-null') return ok(null)
    if (mapped === 'not-found') return err(notFoundError)
    return mapped
  }
  return decode(outcome.parsed)
}

/**
 * 生产 M-Deploy facade 端口指向 M-Deploy 公开 HTTP API。
 * baseUrl 可用 MERISTEM_MDEPLOY_URL 覆盖，默认取内网服务地址。
 */
export function createHttpMDeployFacadePort(
  options: MDeployFacadeAdapterOptions = {}
): MDeployFacadePort {
  const baseUrl = options.baseUrl ?? process.env.MERISTEM_MDEPLOY_URL ?? serviceUrl('m-deploy')
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))

  return {
    async desiredState(context) {
      return sendJson(
        fetcher,
        `${baseUrl}/api/v0/deploy/desired-state`,
        'GET',
        context,
        undefined,
        value => decodeOrFailure(MDeployDesiredStateSummaryV01Schema, value, context)
      )
    },
    async propose(body, context) {
      return sendJson(fetcher, `${baseUrl}/api/v0/deploy/proposals`, 'POST', context, body, value =>
        decodeOrFailure(MDeployProposalResponseSchema, value, context)
      )
    },
    async proposal(proposalId, context) {
      return sendJsonNullable(
        fetcher,
        `${baseUrl}/api/v0/deploy/proposals/${encodeURIComponent(proposalId)}`,
        'GET',
        context,
        undefined,
        value => decodeOrFailure(MDeployProposalResponseSchema, value, context)
      )
    },
    async approve(proposalId, body, context) {
      return sendJson(
        fetcher,
        `${baseUrl}/api/v0/deploy/proposals/${encodeURIComponent(proposalId)}/approve`,
        'POST',
        context,
        body,
        value => decodeOrFailure(MDeployApprovalResponseSchema, value, context)
      )
    },
    async apply(body, context) {
      return sendJson(fetcher, `${baseUrl}/api/v0/deploy/apply`, 'POST', context, body, value =>
        decodeOrFailure(MDeployApplyOperationResponseSchema, value, context)
      )
    },
    async rollback(body, context) {
      return sendJson(fetcher, `${baseUrl}/api/v0/deploy/rollback`, 'POST', context, body, value =>
        decodeOrFailure(MDeployRollbackOperationResponseSchema, value, context)
      )
    },
    async drift(context) {
      return sendJson(fetcher, `${baseUrl}/api/v0/deploy/drift`, 'GET', context, undefined, value =>
        decodeOrFailure(MDeployDriftResponseSchema, value, context)
      )
    },
    async driftCheck(context) {
      return sendJson(fetcher, `${baseUrl}/api/v0/deploy/drift/check`, 'POST', context, {}, value =>
        decodeOrFailure(MDeployDriftCheckResponseSchema, value, context)
      )
    },
    async evidence(context) {
      return sendJson(
        fetcher,
        `${baseUrl}/api/v0/deploy/evidence`,
        'GET',
        context,
        undefined,
        value => decodeOrFailure(MDeployEvidenceResponseSchema, value, context)
      )
    },
    async agents(context) {
      return sendJson(
        fetcher,
        `${baseUrl}/api/v0/deploy/agents`,
        'GET',
        context,
        undefined,
        value => decodeOrFailure(MDeployAgentsResponseSchema, value, context)
      )
    }
  }
}
