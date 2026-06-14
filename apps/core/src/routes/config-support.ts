import { redactSecrets } from '../../../../packages/common/src/secret-redaction.ts'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import {
  internalTokenHeaderName,
  validateInternalRequest
} from '../../../../packages/internal-http/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import type { CoreDeps, ServiceError } from '../types.ts'
import type {
  AckStatus,
  ConfigDetailRecord,
  ConfigDomain,
  ConfigListRecord,
  ConfigPortListRecord,
  ConfigStatus
} from './config-schemas.ts'
import { configDomains, configStatuses } from './config-schemas.ts'

export function configErrorStatus(error: ServiceError): 404 | 409 | 500 | 503 {
  switch (error.code) {
    case 'config.not_found':
      return 404
    case 'config.invalid_state':
    case 'config.rollback_unknown_version':
    case 'config.version_mismatch':
    case 'config.ack_timeout':
    case 'config.ack_invalid_status':
      return 409
    case 'policy.unavailable':
    case 'audit.unavailable':
      return 503
    default:
      return 500
  }
}

export function normalizeConfigErrorCode(code: string): string {
  if (code === 'config.rollback_unknown_version') return 'config.unknown_version'
  if (code === 'config.secret_plaintext') return 'config.secret_plaintext_rejected'
  return code
}

export function containsPlaintextSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPlaintextSecret)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'secretref' || normalizedKey.endsWith('secretref')) return false
    if (
      /(password|secret|token|privatekey|apikey)/u.test(normalizedKey) &&
      typeof entry === 'string' &&
      entry.length > 0
    ) {
      return true
    }
    return containsPlaintextSecret(entry)
  })
}

export function asConfigDomain(domain: string): ConfigDomain {
  return configDomains.includes(domain as ConfigDomain) ? (domain as ConfigDomain) : 'core'
}

export function asConfigStatus(status: string): ConfigStatus {
  return configStatuses.includes(status as ConfigStatus) ? (status as ConfigStatus) : 'failed'
}

export function toConfigListRecord(record: ConfigPortListRecord): ConfigListRecord {
  return {
    id: record.id,
    configVersion: record.configVersion,
    domain: asConfigDomain(record.domain),
    status: asConfigStatus(record.status),
    createdBy: record.createdBy,
    createdAt: record.createdAt
  }
}

export function toConfigDetailRecord(
  record: Omit<ConfigDetailRecord, 'domain' | 'status'> & { domain: string; status: string }
): ConfigDetailRecord {
  return {
    ...toConfigListRecord(record),
    schemaVersion: record.schemaVersion,
    configHash: record.configHash,
    targetScope: [...record.targetScope],
    payload: record.payload,
    updatedAt: record.updatedAt,
    ...(record.publishedBy ? { publishedBy: record.publishedBy } : {}),
    ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
    ...(record.rollbackVersion ? { rollbackVersion: record.rollbackVersion } : {})
  }
}

export function throwConfigError(error: ServiceError, correlationId?: string): never {
  throw new CoreError(
    configErrorStatus(error),
    normalizeConfigErrorCode(error.code),
    error.message,
    correlationId
  )
}

export async function requireConfiguredPermission(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
  }
) {
  const auth = await requireActor(deps, input.headers)
  const permissions = await deps.auth.getPermissions(auth.actor)
  if (!permissions.ok) {
    throw new CoreError(503, permissions.error.code, permissions.error.message, auth.correlationId)
  }
  if (!permissions.value.includes(input.action)) {
    throw new CoreError(403, 'policy.denied', 'permission denied', auth.correlationId)
  }
  return auth
}

export async function requireConfigPolicy(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
  }
) {
  const auth = await requireActor(deps, input.headers)
  const decision = await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return { auth, decision }
}

export async function writeConfigAudit(
  deps: CoreDeps,
  input: {
    actor: ActorId
    action: Permission
    resource: string
    decisionId: string
    result: string
    correlationId: string
    payload: Record<string, unknown>
  }
) {
  const audit = await deps.log.writeAudit({
    actor: input.actor,
    action: input.action,
    resource: input.resource,
    decisionId: input.decisionId,
    result: input.result,
    correlationId: input.correlationId,
    payload: input.payload
  })

  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

export function validateConfigInternalRequest(request: Request, correlationId: string) {
  const tokenValue = request.headers.get(internalTokenHeaderName)
  const result = process.env.MERISTEM_INTERNAL_TOKEN
    ? validateInternalRequest(request.headers)
    : tokenValue
      ? { ok: true as const }
      : {
          ok: false as const,
          error: { code: 'internal.unauthorized', message: 'invalid internal token' }
        }

  if (!result.ok) {
    const status = result.error.code === 'internal.unavailable' ? 503 : 401
    throw new CoreError(status, result.error.code, result.error.message, correlationId)
  }
}

export function normalizeAckInput(body: {
  version?: string
  configVersion?: string
  targetService?: string
  ackedBy?: string
  status: AckStatus
  error?: string
  errorCode?: string
  errorMessage?: string
}) {
  const version = body.version ?? body.configVersion
  const targetService = body.targetService ?? body.ackedBy
  if (!version) {
    throw new CoreError(
      400,
      'config.ack_invalid_payload',
      'apply ack requires version or configVersion'
    )
  }
  if (!targetService) {
    throw new CoreError(
      400,
      'config.ack_invalid_payload',
      'apply ack requires targetService or ackedBy'
    )
  }

  return {
    version,
    targetService,
    status: body.status,
    ...(body.error ? { error: body.error } : {}),
    ...(body.errorCode || body.errorMessage
      ? { error: [body.errorCode, body.errorMessage].filter(Boolean).join(': ') }
      : {})
  }
}

export function toAckResponseError(body: { errorCode?: string; errorMessage?: string }) {
  return {
    ...(body.errorCode ? { errorCode: redactSecrets(body.errorCode) } : {}),
    ...(body.errorMessage ? { errorMessage: redactSecrets(body.errorMessage) } : {})
  }
}
