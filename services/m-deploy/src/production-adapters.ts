import { err, ok, type Result } from '../../../packages/common/src/result.ts'
import type {
  MDeployApprovalStatusFromSchema,
  MDeployApprovalV01FromSchema,
  MDeployStorageRefV01FromSchema,
  PolicyResult
} from '../../../packages/contracts/src/index.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  internalRequestHeaders,
  serviceErrorFromEnvelope
} from '../../../packages/internal-http/src/index.ts'
import { redactSecretRef, type SecretManager } from '../../../packages/secrets/src/index.ts'
import type { SharedAuthVerifier } from '../../../packages/auth/src/index.ts'
import type { MDeployDeps, MDeployError } from './deps.ts'

type ServiceUrls = {
  policy: string
  log: string
  eventbus: string
}

type ProductionAdapterOptions = {
  urls: ServiceUrls
  authVerifier: SharedAuthVerifier
  secretManager: SecretManager
  fetchImpl?: typeof fetch
  now?: () => string
  approvalTtlMs?: number
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, name) : undefined
}

function stringField(value: unknown, name: string): string | null {
  const candidate = field(value, name)
  return typeof candidate === 'string' ? candidate : null
}

function serviceFailure(value: unknown, fallback: { code: string; message: string }): MDeployError {
  return serviceErrorFromEnvelope(value, fallback)
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  unavailableCode: string
): Promise<Result<unknown, MDeployError>> {
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: internalRequestHeaders(init.headers)
    })
    const body: unknown = await response.json()
    return response.ok
      ? ok(body)
      : err(
          serviceFailure(body, {
            code: unavailableCode,
            message: `dependency returned status ${response.status}`
          })
        )
  } catch (error) {
    return err({
      code: unavailableCode,
      message: error instanceof Error ? error.message : 'dependency request failed'
    })
  }
}

function readPolicyResult(value: unknown): PolicyResult | null {
  return value === 'allow' ||
    value === 'deny' ||
    value === 'require_manual_review' ||
    value === 'require_multi_approval'
    ? value
    : null
}

function readProposalStatus(value: unknown): MDeployApprovalStatusFromSchema | null {
  return value === 'pending' || value === 'approved' || value === 'rejected' ? value : null
}

function readStorageRef(value: unknown): MDeployStorageRefV01FromSchema | null {
  const uri = stringField(value, 'uri')
  const digest = field(value, 'digest')
  const algorithm = stringField(digest, 'algorithm')
  const digestValue = stringField(digest, 'value')
  const redactionStatus = stringField(value, 'redactionStatus')
  if (
    uri === null ||
    (algorithm !== 'sha256' && algorithm !== 'sha512') ||
    digestValue === null ||
    (redactionStatus !== 'redacted' && redactionStatus !== 'metadata_only')
  ) {
    return null
  }
  return { uri, digest: { algorithm, value: digestValue }, redactionStatus }
}

/** Real loopback clients for the authority boundaries consumed by production M-Deploy. */
export function createProductionMDeployBoundaryAdapters(
  options: ProductionAdapterOptions
): Pick<MDeployDeps, 'auth' | 'policy' | 'log' | 'events' | 'secretProvider'> {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? (() => new Date().toISOString())
  const approvalTtlMs = options.approvalTtlMs ?? 24 * 60 * 60 * 1000

  return {
    auth: {
      async verify(bearerToken) {
        const token = bearerToken.replace(/^Bearer\s+/i, '')
        const verified = await options.authVerifier.verify(token)
        return verified.ok
          ? ok({ actor: verified.session.actor.id })
          : err({ code: `auth.${verified.code}`, message: verified.message })
      }
    },
    policy: {
      async authorize(input) {
        const response = await requestJson(
          fetchImpl,
          `${options.urls.policy}/internal/v0/authorize`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
          },
          'policy.unavailable'
        )
        if (!response.ok) return response
        const decision = field(response.value, 'decision')
        const decisionId = stringField(decision, 'id')
        const result = readPolicyResult(field(decision, 'result'))
        return decisionId && result
          ? ok({ decisionId, result })
          : err({ code: 'policy.invalid_response', message: 'invalid authorization response' })
      },
      async recordApproval(input) {
        const expiresAt = new Date(Date.parse(now()) + approvalTtlMs).toISOString()
        const response = await requestJson(
          fetchImpl,
          `${options.urls.policy}/internal/v0/policy/mdeploy/approvals/${encodeURIComponent(input.proposal.proposalId)}/votes`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              proposalActor: input.proposal.actor,
              policyDecisionId: input.proposal.policyDecisionId,
              actor: input.actor,
              result: input.result,
              expiresAt
            })
          },
          'policy.unavailable'
        )
        if (!response.ok) return response
        const approvalId = stringField(response.value, 'approvalId')
        const policyDecisionId = stringField(response.value, 'policyDecisionId')
        const timestamp = stringField(response.value, 'timestamp')
        const proposalStatus = readProposalStatus(field(response.value, 'proposalStatus'))
        if (!approvalId || !policyDecisionId || !timestamp || !proposalStatus) {
          return err({ code: 'policy.invalid_response', message: 'invalid approval response' })
        }
        const approval: MDeployApprovalV01FromSchema = {
          schemaVersion: 'mdeploy.approval@0.1.0',
          approvalId,
          proposalId: input.proposal.proposalId,
          approver: input.actor,
          timestamp,
          result: input.result,
          policyDecisionId,
          correlationId: input.correlationId
        }
        return ok({ approval, proposalStatus })
      },
      async proveProductionApplyQuorum(input) {
        const response = await requestJson(
          fetchImpl,
          `${options.urls.policy}/internal/v0/policy/mdeploy/approvals/${encodeURIComponent(input.proposal.proposalId)}/quorum`,
          { method: 'POST' },
          'policy.unavailable'
        )
        if (!response.ok) return response
        const proofId = stringField(response.value, 'proofId')
        const proposalId = stringField(response.value, 'proposalId')
        const issuedAt = stringField(response.value, 'issuedAt')
        const approversValue = field(response.value, 'approvers')
        const first = Array.isArray(approversValue) ? approversValue[0] : undefined
        const second = Array.isArray(approversValue) ? approversValue[1] : undefined
        return proofId &&
          proposalId &&
          issuedAt &&
          typeof first === 'string' &&
          typeof second === 'string'
          ? ok({ proofId, proposalId, approvers: [first, second], issuedAt })
          : err({ code: 'policy.invalid_response', message: 'invalid quorum proof response' })
      }
    },
    log: {
      async writeAudit(input) {
        const response = await requestJson(
          fetchImpl,
          `${options.urls.log}/internal/v0/audit`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              actor: input.actor,
              action: input.action,
              resource: input.resource,
              decisionId: input.policyDecisionId,
              result: input.result,
              correlationId: input.correlationId,
              ...(input.quorumProofId ? { payload: { quorumProofId: input.quorumProofId } } : {})
            })
          },
          'audit.unavailable'
        )
        if (!response.ok) return response
        const auditId = stringField(field(response.value, 'entry'), 'id')
        return auditId
          ? ok({ auditId })
          : err({ code: 'audit.invalid_response', message: 'invalid Audit response' })
      },
      async writeTimeline(input) {
        const response = await requestJson(
          fetchImpl,
          `${options.urls.log}/internal/v0/timeline`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
          },
          'timeline.unavailable'
        )
        return response.ok ? ok(undefined) : response
      },
      async writeFull(input) {
        const response = await requestJson(
          fetchImpl,
          `${options.urls.log}/internal/v0/full`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              level: input.level,
              source: 'm-deploy',
              message: input.message,
              correlationId: input.correlationId,
              payload: { errorCode: input.errorCode }
            })
          },
          'full_log.unavailable'
        )
        return response.ok ? ok(undefined) : response
      },
      async writeEvidence(input) {
        const response = await requestJson(
          fetchImpl,
          `${options.urls.log}/internal/v0/deployment-evidence`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input)
          },
          'evidence.unavailable'
        )
        if (!response.ok) return response
        const storageRef = readStorageRef(field(response.value, 'storageRef'))
        return storageRef
          ? ok(storageRef)
          : err({ code: 'evidence.invalid_response', message: 'invalid evidence response' })
      }
    },
    events: {
      async publish(subject, payload) {
        const correlationId = stringField(payload, 'correlationId') ?? undefined
        const event = createEventEnvelope({
          type: subject.replace(/\.v0$/, ''),
          source: 'm-deploy',
          subject,
          payload,
          ...(correlationId ? { correlationId } : {})
        })
        const response = await requestJson(
          fetchImpl,
          `${options.urls.eventbus}/internal/v0/publish`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subject, event })
          },
          'event.unavailable'
        )
        return response.ok ? ok(undefined) : response
      }
    },
    secretProvider: {
      async resolve(ref) {
        const resolved = await options.secretManager.read(ref)
        if (!resolved.ok) return err({ code: resolved.error.code, message: resolved.error.message })
        return ok({
          redactedRef: JSON.stringify(redactSecretRef(ref)),
          ...(ref.version === undefined ? {} : { version: ref.version }),
          auditId: crypto.randomUUID()
        })
      }
    }
  }
}

export type { ProductionAdapterOptions, ServiceUrls }
