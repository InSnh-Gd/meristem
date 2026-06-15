import { err, ok } from '../../../../packages/common/src/result.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
import type {
  ApprovalDetailResponse,
  ApprovalListResponse,
  MNetRegionalProfile
} from '../../../../packages/contracts/src/index.ts'
import { serviceErrorFromHttpResponse } from '../effect-helpers.ts'
import type {
  ApprovalReaderPort,
  NetworkProfileReaderPort,
  ReaderContext
} from '../types/approval-profile-readers.ts'

type PublicReaderAdapterOptions = {
  baseUrl?: string
  fetcher?: PublicReaderFetch
}

export type PublicReaderFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function requestHeaders(context: ReaderContext): Record<string, string> {
  return {
    authorization: `Bearer ${context.bearerToken}`,
    'x-correlation-id': context.correlationId
  }
}

async function fetchPublicJson(
  fetcher: PublicReaderFetch,
  url: string,
  context: ReaderContext,
  failureCode: string,
  failureMessage: string
) {
  try {
    const response = await fetcher(url, { headers: requestHeaders(context) })
    const body = await parseJson(response)
    if (!response.ok) {
      if (response.status === 404) return ok(null)
      return err(serviceErrorFromHttpResponse(body, failureCode, failureMessage))
    }
    return ok(body)
  } catch {
    return err({ code: failureCode, message: failureMessage })
  }
}

function asApprovalList(value: unknown): ApprovalListResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const approvals = Reflect.get(value, 'approvals')
  return Array.isArray(approvals) ? (value as ApprovalListResponse) : null
}

function asApprovalDetail(value: unknown): ApprovalDetailResponse | null {
  if (typeof value !== 'object' || value === null) return null
  const id = Reflect.get(value, 'id')
  const votes = Reflect.get(value, 'votes')
  return typeof id === 'string' && Array.isArray(votes) ? (value as ApprovalDetailResponse) : null
}

function asProfileList(value: unknown): { profiles: MNetRegionalProfile[] } | null {
  if (typeof value !== 'object' || value === null) return null
  const profiles = Reflect.get(value, 'profiles')
  return Array.isArray(profiles) ? (value as { profiles: MNetRegionalProfile[] }) : null
}

function asProfileDetail(value: unknown): MNetRegionalProfile | null {
  if (typeof value !== 'object' || value === null) return null
  const profileVersion = Reflect.get(value, 'profileVersion')
  return typeof profileVersion === 'string' ? (value as MNetRegionalProfile) : null
}

/**
 * 生产审批读取端口只调用 M-Policy 公开 `/api/v0/policy/approvals*` 路由并透传调用者 Bearer token。
 */
export function createHttpApprovalReaderPort(
  options: PublicReaderAdapterOptions = {}
): ApprovalReaderPort {
  const baseUrl = options.baseUrl ?? serviceUrl('m-policy')
  const fetcher: PublicReaderFetch = options.fetcher ?? ((input, init) => fetch(input, init))
  return {
    requiredPermission: 'policy:approval-read',
    async list(context) {
      const result = await fetchPublicJson(
        fetcher,
        `${baseUrl}/api/v0/policy/approvals`,
        context,
        'm-policy.unavailable',
        'M-Policy approval API unavailable'
      )
      if (!result.ok) return result
      const body = asApprovalList(result.value)
      return body
        ? ok(body)
        : err({ code: 'm-policy.invalid_response', message: 'M-Policy approval API invalid response' })
    },
    async get(id, context) {
      const result = await fetchPublicJson(
        fetcher,
        `${baseUrl}/api/v0/policy/approvals/${encodeURIComponent(id)}`,
        context,
        'm-policy.unavailable',
        'M-Policy approval API unavailable'
      )
      if (!result.ok) return result
      if (result.value === null) return ok(null)
      const body = asApprovalDetail(result.value)
      return body
        ? ok(body)
        : err({ code: 'm-policy.invalid_response', message: 'M-Policy approval API invalid response' })
    }
  }
}

/**
 * 生产 profile 读取端口只调用 M-Net 公开 `/api/v0/network-profiles*` 路由并透传调用者 Bearer token。
 */
export function createHttpNetworkProfileReaderPort(
  options: PublicReaderAdapterOptions = {}
): NetworkProfileReaderPort {
  const baseUrl = options.baseUrl ?? serviceUrl('m-net')
  const fetcher: PublicReaderFetch = options.fetcher ?? ((input, init) => fetch(input, init))
  return {
    requiredPermission: 'network:profile-read',
    async list(context) {
      const result = await fetchPublicJson(
        fetcher,
        `${baseUrl}/api/v0/network-profiles`,
        context,
        'mnet.unavailable',
        'M-Net profile API unavailable'
      )
      if (!result.ok) return result
      const body = asProfileList(result.value)
      return body
        ? ok(body)
        : err({ code: 'mnet.invalid_response', message: 'M-Net profile API invalid response' })
    },
    async get(profileVersion, context) {
      const result = await fetchPublicJson(
        fetcher,
        `${baseUrl}/api/v0/network-profiles/${encodeURIComponent(profileVersion)}`,
        context,
        'mnet.unavailable',
        'M-Net profile API unavailable'
      )
      if (!result.ok) return result
      if (result.value === null) return ok(null)
      const body = asProfileDetail(result.value)
      return body
        ? ok(body)
        : err({ code: 'mnet.invalid_response', message: 'M-Net profile API invalid response' })
    }
  }
}
