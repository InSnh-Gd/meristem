import { extractBearerToken, verifyLocalToken } from '../../../packages/auth/src/index.ts'
import { extensionPermission, type Permission } from '../../../packages/contracts/src/literals.ts'
import type {
  DisableExtensionRequest,
  EnableExtensionRequest,
  MExtensionLifecyclePayload
} from '../../../packages/contracts/src/types/extension.ts'
import {
  mExtensionEventSubjects,
  mExtensionEventTypes,
  mExtensionManifestVersion,
  mExtensionResource,
  mExtensionScope
} from '../../../packages/contracts/src/types/extension.ts'
import { validateExtensionManifest } from './manifest.ts'
import type {
  AuthContext,
  LifecyclePayloadInput,
  MExtensionDeps,
  MExtensionPolicyDecision
} from './deps.ts'

export function correlationIdFromHeaders(headers: Record<string, string | undefined>): string {
  const value = headers['x-correlation-id']
  return value && value.trim().length > 0 ? value : crypto.randomUUID()
}

export function raise(
  status: number,
  code: string,
  message: string,
  correlationId?: string
): never {
  throw Object.assign(new Error(message), { status, code, correlationId })
}

/**
 * 所有公开路由共用 Bearer token 校验与关联 ID 解析，确保鉴权错误语义稳定。
 */
export async function requireActor(
  headers: Record<string, string | undefined>,
  jwtSecret: string
): Promise<AuthContext> {
  const correlationId = correlationIdFromHeaders(headers)
  const token = extractBearerToken(headers.authorization)
  if (!token)
    throw Object.assign(new Error('Bearer token is required'), {
      status: 401,
      code: 'auth.missing_token',
      correlationId
    })

  const verified = await verifyLocalToken({ token, secret: jwtSecret })
  if (!verified.ok)
    throw Object.assign(new Error(verified.message), {
      status: 401,
      code: verified.code,
      correlationId
    })

  return { actor: verified.actor, correlationId }
}

/**
 * 策略检查必须先写阻断日志，再对写操作补写 fail-closed 审计，保持原有拒绝顺序。
 */
export async function authorize(
  deps: MExtensionDeps,
  auth: AuthContext,
  action: Permission,
  resource: string
): Promise<MExtensionPolicyDecision> {
  let decision: MExtensionPolicyDecision
  try {
    decision = await deps.policy.authorize(auth.actor, action, resource)
  } catch {
    raise(503, 'policy.unavailable', 'M-Policy unavailable', auth.correlationId)
  }

  if (decision.result === 'allow') return decision

  await deps.log.writeFull('warn', `policy blocked ${action}`, auth.correlationId, {
    actor: auth.actor,
    resource,
    decisionId: decision.id,
    result: decision.result
  })
  if (action !== extensionPermission.read) {
    await writeAuditFailClosed(deps, {
      auth,
      action,
      resource,
      result: 'deny',
      payload: { decisionId: decision.id, reasons: decision.reasons }
    })
  }

  throw Object.assign(new Error(`permission denied for ${action}`), {
    status: 403,
    code: 'policy.denied',
    correlationId: auth.correlationId,
    decisionId: decision.id
  })
}

export function assertSystemDefault(
  body: EnableExtensionRequest | DisableExtensionRequest,
  correlationId: string
): void {
  if (
    (body.scopeType && body.scopeType !== mExtensionScope.type) ||
    (body.scopeId && body.scopeId !== mExtensionScope.id)
  ) {
    throw Object.assign(
      new Error(
        `Only ${mExtensionScope.type}/${mExtensionScope.id} extension instances are supported`
      ),
      { status: 409, code: 'extension.scope.unsupported', correlationId }
    )
  }
}

export function lifecyclePayload(input: LifecyclePayloadInput): MExtensionLifecyclePayload {
  return {
    extensionId: input.definition.id,
    manifestVersion: input.definition.manifestVersion,
    kind: input.definition.kind,
    actor: input.actor,
    decisionId: input.decisionId,
    scopeType: mExtensionScope.type,
    scopeId: mExtensionScope.id,
    ...(input.reason ? { reason: input.reason } : {}),
    correlationId: input.correlationId,
    ...(input.errorCode ? { errorCode: input.errorCode } : {})
  }
}

export async function auditBeforeMutation(
  deps: MExtensionDeps,
  input: {
    auth: AuthContext
    action: string
    resource: string
    decisionId: string
    payload: unknown
  }
): Promise<void> {
  try {
    await deps.log.writeAudit(
      input.auth.actor,
      input.action,
      input.resource,
      'allow',
      input.auth.correlationId,
      { decisionId: input.decisionId, payload: input.payload }
    )
  } catch {
    raise(503, 'audit.unavailable', 'Audit Log unavailable', input.auth.correlationId)
  }
}

export async function writeAuditFailClosed(
  deps: MExtensionDeps,
  input: { auth: AuthContext; action: string; resource: string; result: string; payload: unknown }
): Promise<void> {
  try {
    await deps.log.writeAudit(
      input.auth.actor,
      input.action,
      input.resource,
      input.result,
      input.auth.correlationId,
      input.payload
    )
  } catch {
    raise(503, 'audit.unavailable', 'Audit Log unavailable', input.auth.correlationId)
  }
}

/**
 * 生命周期事件失败时保留原始对外错误，并在 fallback 发布失败事件时只追加诊断日志。
 */
export async function publishLifecycle(
  deps: MExtensionDeps,
  input: {
    subject: string
    type: string
    payload: MExtensionLifecyclePayload
    correlationId: string
    failureCode: string
    failureSubject?: string
    failureType?: string
  }
): Promise<void> {
  try {
    await deps.events.publish(input.subject, input.type, input.payload, input.correlationId)
  } catch {
    await deps.log.writeFull('error', `failed to publish ${input.subject}`, input.correlationId, {
      errorCode: input.failureCode,
      extensionId: input.payload.extensionId
    })
    if (input.failureSubject && input.failureType) {
      await deps.events
        .publish(
          input.failureSubject,
          input.failureType,
          { ...input.payload, errorCode: input.failureCode },
          input.correlationId
        )
        .catch(error => {
          // 原始失败已经通过主错误路径写入 Full Log；这里保留 fallback 失败日志，
          // 但不覆盖最初的业务错误，避免把“失败通知也失败”升级成新的对外语义。
          console.warn(
            `m-extension: failed to publish lifecycle fallback ${input.failureSubject} - ${error instanceof Error ? error.message : String(error)}`
          )
          return undefined
        })
    }
    raise(
      503,
      input.failureCode,
      'extension lifecycle event publication failed',
      input.correlationId
    )
  }
}

export async function rejectManifest(
  deps: MExtensionDeps,
  auth: AuthContext,
  manifest: unknown,
  code: string,
  message: string
): Promise<never> {
  const extensionId =
    typeof manifest === 'object' &&
    manifest !== null &&
    'id' in manifest &&
    typeof manifest.id === 'string'
      ? manifest.id
      : 'unknown'
  const resource = `${mExtensionResource.prefix}:${extensionId}`
  await deps.log.writeFull('warn', 'extension manifest validation failed', auth.correlationId, {
    code,
    actor: auth.actor,
    extensionId
  })
  if (code === 'extension.manifest.risk_unsupported') {
    await writeAuditFailClosed(deps, {
      auth,
      action: mExtensionEventTypes.definitionRejected,
      resource,
      result: 'rejected',
      payload: { errorCode: code }
    })
  }
  await publishLifecycle(deps, {
    subject: mExtensionEventSubjects.definitionRejected,
    type: mExtensionEventTypes.definitionRejected,
    payload: {
      extensionId,
      manifestVersion: mExtensionManifestVersion,
      kind: 'metadata-only',
      actor: auth.actor,
      decisionId: 'manifest-validation',
      scopeType: mExtensionScope.type,
      scopeId: mExtensionScope.id,
      correlationId: auth.correlationId,
      errorCode: code
    },
    correlationId: auth.correlationId,
    failureCode: 'extension.rejected_event_failed'
  })
  raise(409, code, message, auth.correlationId)
}

export async function validateManifestOrReject(
  deps: MExtensionDeps,
  auth: AuthContext,
  manifest: unknown
) {
  const validation = validateExtensionManifest(manifest)
  if (!validation.ok) {
    return await rejectManifest(deps, auth, manifest, validation.code, validation.message)
  }
  return validation.manifest
}

export async function readStore<T>(correlationId: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch {
    raise(503, 'extension.store_unavailable', 'Extension store unavailable', correlationId)
  }
}
