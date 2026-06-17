import { err, ok } from '../../../../packages/common/src/result.ts'
import type { ApprovalActionResponse } from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import { serviceErrorFromHttpResponse } from '../effect-helpers.ts'
import type {
  ApprovalWriterPort,
  NetworkProfileWriterPort,
  ProfileWriteResponse,
  WriterContext
} from '../types/approval-profile-writers.ts'

type PublicWriterAdapterOptions = {
  baseUrl?: string
  fetcher?: PublicWriterFetch
}

export type PublicWriterFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

/**
 * 从 M-Policy/M-Net 的 JSON 响应中提取数据或错误，失败时解析统一 error envelope。
 */
async function fetchJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function requestHeaders(context: WriterContext): Record<string, string> {
  return {
    authorization: `Bearer ${context.bearerToken}`,
    'content-type': 'application/json',
    'x-correlation-id': context.correlationId
  }
}

/**
 * 向 M-Policy/M-Net 公开 API 发送 POST 请求。
 * Core 透传调用者的 Bearer token 和 correlationId，不做 body 改写。
 */
async function postJson(
  fetcher: PublicWriterFetch,
  url: string,
  body: unknown,
  context: WriterContext,
  failureCode: string,
  failureMessage: string
) {
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: requestHeaders(context),
      body: JSON.stringify(body)
    })
    const parsed = await fetchJsonResponse(response)
    if (!response.ok) {
      if (response.status === 404) return err({ code: 'approval.not_found', message: 'not found' })
      return err(serviceErrorFromHttpResponse(parsed, failureCode, failureMessage))
    }
    return ok(parsed)
  } catch {
    return err({ code: failureCode, message: failureMessage })
  }
}

/**
 * 生产审批写端口调用 M-Policy 公开 POST /api/v0/policy/approvals/:id/approve 和
 * POST /api/v0/policy/approvals/:id/reject 路由，透传调用者 Bearer token。
 */
export function createHttpApprovalWriterPort(
  options: PublicWriterAdapterOptions = {}
): ApprovalWriterPort {
  const baseUrl = options.baseUrl ?? serviceUrl('m-policy')
  const fetcher: PublicWriterFetch = options.fetcher ?? ((input, init) => fetch(input, init))
  return {
    async approve(id, body, context) {
      const result = await postJson(
        fetcher,
        `${baseUrl}/api/v0/policy/approvals/${encodeURIComponent(id)}/approve`,
        { reason: body.reason },
        context,
        'm-policy.unavailable',
        'M-Policy approval API unavailable'
      )
      if (!result.ok) return result
      const value = result.value as ApprovalActionResponse
      if (!value || typeof value !== 'object' || !('approval' in value)) {
        return err({
          code: 'm-policy.invalid_response',
          message: 'M-Policy approval API invalid response'
        })
      }
      return ok(value)
    },
    async reject(id, body, context) {
      const result = await postJson(
        fetcher,
        `${baseUrl}/api/v0/policy/approvals/${encodeURIComponent(id)}/reject`,
        { reason: body.reason },
        context,
        'm-policy.unavailable',
        'M-Policy approval API unavailable'
      )
      if (!result.ok) return result
      const value = result.value as ApprovalActionResponse
      if (!value || typeof value !== 'object' || !('approval' in value)) {
        return err({
          code: 'm-policy.invalid_response',
          message: 'M-Policy approval API invalid response'
        })
      }
      return ok(value)
    }
  }
}

/**
 * 生产 profile 写端口调用 M-Net 公开 POST /api/v0/networks/:id/profile 路由，
 * 透传调用者 Bearer token。
 */
export function createHttpNetworkProfileWriterPort(
  options: PublicWriterAdapterOptions = {}
): NetworkProfileWriterPort {
  const baseUrl = options.baseUrl ?? serviceUrl('m-net')
  const fetcher: PublicWriterFetch = options.fetcher ?? ((input, init) => fetch(input, init))
  return {
    async setProfile(networkId, body, context) {
      const result = await postJson(
        fetcher,
        `${baseUrl}/api/v0/networks/${encodeURIComponent(networkId)}/profile`,
        { profileVersion: body.profileVersion, reason: body.reason },
        context,
        'mnet.unavailable',
        'M-Net profile API unavailable'
      )
      if (!result.ok) return result
      const value = result.value as ProfileWriteResponse
      if (!value || typeof value !== 'object' || !('status' in value)) {
        return err({
          code: 'mnet.invalid_response',
          message: 'M-Net profile API invalid response'
        })
      }
      return ok(value)
    }
  }
}
