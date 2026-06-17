import { Either } from 'effect'
import * as Schema from 'effect/Schema'
import { err, ok } from '../../../../packages/common/src/result.ts'
import type {
  ApprovalDetailResponse,
  ApprovalListResponse,
  MNetRegionalProfile
} from '../../../../packages/contracts/src/index.ts'
import {
  ApprovalDetailResponseSchema,
  ApprovalListResponseSchema,
  MNetProfileDetailResponseSchema,
  MNetProfileListResponseSchema
} from '../../../../packages/contracts/src/index.ts'
import { serviceUrl } from '../../../../packages/internal-http/src/index.ts'
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

export type PublicReaderFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

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
  const decoded = Schema.decodeUnknownEither(ApprovalListResponseSchema)(value)
  return Either.isRight(decoded)
    ? {
        approvals: decoded.right.approvals.map(approval => ({
          id: approval.id,
          policyDecisionId: approval.policyDecisionId,
          originService: approval.originService,
          operationId: approval.operationId,
          requestedBy: approval.requestedBy,
          requiredAction: approval.requiredAction,
          status: approval.status,
          quorumRequired: approval.quorumRequired,
          expiresAt: approval.expiresAt,
          createdAt: approval.createdAt,
          updatedAt: approval.updatedAt,
          ...(approval.completedAt !== undefined ? { completedAt: approval.completedAt } : {})
        }))
      }
    : null
}

function asApprovalDetail(value: unknown): ApprovalDetailResponse | null {
  const decoded = Schema.decodeUnknownEither(ApprovalDetailResponseSchema)(value)
  return Either.isRight(decoded)
    ? {
        id: decoded.right.id,
        policyDecisionId: decoded.right.policyDecisionId,
        originService: decoded.right.originService,
        operationId: decoded.right.operationId,
        requestedBy: decoded.right.requestedBy,
        requiredAction: decoded.right.requiredAction,
        status: decoded.right.status,
        quorumRequired: decoded.right.quorumRequired,
        expiresAt: decoded.right.expiresAt,
        createdAt: decoded.right.createdAt,
        updatedAt: decoded.right.updatedAt,
        ...(decoded.right.completedAt !== undefined
          ? { completedAt: decoded.right.completedAt }
          : {}),
        votes: decoded.right.votes.map(vote => ({
          id: vote.id,
          approvalId: vote.approvalId,
          actor: vote.actor,
          vote: vote.vote,
          createdAt: vote.createdAt,
          ...(vote.reason !== undefined ? { reason: vote.reason } : {})
        }))
      }
    : null
}

function asProfileList(value: unknown): { profiles: MNetRegionalProfile[] } | null {
  const decoded = Schema.decodeUnknownEither(MNetProfileListResponseSchema)(value)
  return Either.isRight(decoded)
    ? {
        profiles: decoded.right.profiles.map(profile => ({
          profileVersion: profile.profileVersion,
          region: profile.region,
          displayName: profile.displayName,
          schemaVersion: profile.schemaVersion,
          status: profile.status,
          rules: { ...profile.rules },
          capabilities: { ...profile.capabilities }
        }))
      }
    : null
}

function asProfileDetail(value: unknown): MNetRegionalProfile | null {
  const decoded = Schema.decodeUnknownEither(MNetProfileDetailResponseSchema)(value)
  return Either.isRight(decoded)
    ? {
        profileVersion: decoded.right.profileVersion,
        region: decoded.right.region,
        displayName: decoded.right.displayName,
        schemaVersion: decoded.right.schemaVersion,
        status: decoded.right.status,
        rules: { ...decoded.right.rules },
        capabilities: { ...decoded.right.capabilities }
      }
    : null
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
        : err({
            code: 'm-policy.invalid_response',
            message: 'M-Policy approval API invalid response'
          })
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
        : err({
            code: 'm-policy.invalid_response',
            message: 'M-Policy approval API invalid response'
          })
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
