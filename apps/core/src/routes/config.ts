import { Elysia, t } from 'elysia'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import { internalTokenHeaderName, validateInternalRequest } from '../../../../packages/internal-http/src/index.ts'
import { redactSecrets } from '../../../../packages/common/src/secret-redaction.ts'
import { CoreError } from '../core-error.ts'
import { correlationIdFromHeader } from '../errors.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps, ServiceError } from '../types.ts'

type ConfigStatus = 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
type ConfigDomain = 'core' | 'm-net' | 'm-policy' | 'm-log' | 'm-extension' | 'm-ui'
type AckStatus = 'acked' | 'failed'

type ConfigListRecord = {
  id: string
  configVersion: string
  domain: ConfigDomain
  status: ConfigStatus
  createdBy: string
  createdAt: string
}

type ConfigPortListRecord = Omit<ConfigListRecord, 'domain' | 'status'> & {
  domain: string
  status: string
}

type ConfigDetailRecord = ConfigListRecord & {
  schemaVersion: string
  configHash: string
  targetScope: string[]
  payload: unknown
  updatedAt: string
  publishedBy?: string
  publishedAt?: string
  rollbackVersion?: string
}

const configDomains = ['core', 'm-net', 'm-policy', 'm-log', 'm-extension', 'm-ui'] as const
const configStatuses = ['draft', 'validated', 'published', 'applied', 'failed', 'rolled_back'] as const
const ackStatuses = ['acked', 'failed'] as const

const configParamsSchema = t.Object({
  id: t.String({ minLength: 1 })
})

const configStatusSchema = t.UnionEnum(configStatuses)

const configListRecordSchema = t.Object({
  id: t.String(),
  configVersion: t.String(),
  domain: t.UnionEnum(configDomains),
  status: configStatusSchema,
  createdBy: t.String(),
  createdAt: t.String()
})

const configDetailRecordSchema = t.Object({
  ...configListRecordSchema.properties,
  schemaVersion: t.String(),
  configHash: t.String(),
  targetScope: t.Array(t.String()),
  payload: t.Unknown(),
  updatedAt: t.String(),
  publishedBy: t.Optional(t.String()),
  publishedAt: t.Optional(t.String()),
  rollbackVersion: t.Optional(t.String())
})

const configDraftBodySchema = t.Object({
  domain: t.UnionEnum(configDomains),
  payload: t.Unknown(),
  targetScope: t.Optional(t.Array(t.String()))
})

const configDraftResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    configVersion: t.String(),
    status: t.Literal('draft'),
    createdAt: t.String()
  })
})

const configValidateResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    status: t.Literal('validated')
  })
})

const configPublishBodySchema = t.Object({
  reason: t.String({ minLength: 1 })
})

const configPublishResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    configVersion: t.String(),
    status: t.Literal('published'),
    publishedAt: t.String(),
    publishedBy: t.String()
  })
})

const configRollbackBodySchema = t.Object({
  toVersion: t.String({ minLength: 1 }),
  reason: t.String({ minLength: 1 })
})

const configRollbackResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    status: t.Literal('rolled_back')
  })
})

const configApplyAckBodySchema = t.Object({
  version: t.Optional(t.String({ minLength: 1 })),
  configVersion: t.Optional(t.String({ minLength: 1 })),
  targetService: t.Optional(t.String({ minLength: 1 })),
  ackedBy: t.Optional(t.String({ minLength: 1 })),
  status: t.UnionEnum(ackStatuses),
  error: t.Optional(t.String()),
  errorCode: t.Optional(t.String()),
  errorMessage: t.Optional(t.String())
})

const configApplyAckResponseSchema = t.Object({
  ack: t.Object({
    ackId: t.String(),
    configId: t.String(),
    configVersion: t.String(),
    ackedBy: t.String(),
    status: t.UnionEnum(ackStatuses),
    ackedAt: t.String(),
    errorCode: t.Optional(t.String()),
    errorMessage: t.Optional(t.String())
  })
})

function configErrorStatus(error: ServiceError): 404 | 409 | 500 | 503 {
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

function normalizeConfigErrorCode(code: string): string {
  if (code === 'config.rollback_unknown_version') return 'config.unknown_version'
  if (code === 'config.secret_plaintext') return 'config.secret_plaintext_rejected'
  return code
}

function containsPlaintextSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPlaintextSecret)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'secretref' || normalizedKey.endsWith('secretref')) return false
    if (/(password|secret|token|privatekey|apikey)/u.test(normalizedKey) && typeof entry === 'string' && entry.length > 0) {
      return true
    }
    return containsPlaintextSecret(entry)
  })
}

function asConfigDomain(domain: string): ConfigDomain {
  return configDomains.includes(domain as ConfigDomain) ? domain as ConfigDomain : 'core'
}

function asConfigStatus(status: string): ConfigStatus {
  return configStatuses.includes(status as ConfigStatus) ? status as ConfigStatus : 'failed'
}

function toConfigListRecord(record: ConfigPortListRecord): ConfigListRecord {
  return {
    id: record.id,
    configVersion: record.configVersion,
    domain: asConfigDomain(record.domain),
    status: asConfigStatus(record.status),
    createdBy: record.createdBy,
    createdAt: record.createdAt
  }
}

function toConfigDetailRecord(record: Omit<ConfigDetailRecord, 'domain' | 'status'> & { domain: string; status: string }): ConfigDetailRecord {
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

function throwConfigError(error: ServiceError, correlationId?: string): never {
  throw new CoreError(configErrorStatus(error), normalizeConfigErrorCode(error.code), error.message, correlationId)
}

async function requireConfiguredPermission(
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

async function requireConfigPolicy(
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

async function writeConfigAudit(
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

function validateConfigInternalRequest(request: Request, correlationId: string) {
  const tokenValue = request.headers.get(internalTokenHeaderName)
  const result = process.env.MERISTEM_INTERNAL_TOKEN
    ? validateInternalRequest(request.headers)
    : tokenValue
      ? { ok: true as const }
      : { ok: false as const, error: { code: 'internal.unauthorized', message: 'invalid internal token' } }

  if (!result.ok) {
    const status = result.error.code === 'internal.unavailable' ? 503 : 401
    throw new CoreError(status, result.error.code, result.error.message, correlationId)
  }
}

function normalizeAckInput(body: {
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
  if (!version) throw new CoreError(400, 'config.ack_invalid_payload', 'apply ack requires version or configVersion')
  if (!targetService) throw new CoreError(400, 'config.ack_invalid_payload', 'apply ack requires targetService or ackedBy')

  return {
    version,
    targetService,
    status: body.status,
    ...(body.error ? { error: body.error } : {}),
    ...(body.errorCode || body.errorMessage ? { error: [body.errorCode, body.errorMessage].filter(Boolean).join(': ') } : {})
  }
}

/**
 * Config Lifecycle v0.1 外部 REST 路由负责认证、权限、策略和审计边界；状态机细节只通过 ConfigPort 调用。
 */
export const config = (deps: CoreDeps) => new Elysia({ prefix: '/api/v0/configs' })
  // 读取配置要求 Bearer 身份和 config:read 权限，但不依赖 M-Policy/Audit 可用性，保证只读排障路径可降级工作。
  .get('/', async ({ headers }) => {
    await requireConfiguredPermission(deps, { headers, action: 'config:read' })
    const result = await deps.config.list()
    if (!result.ok) throwConfigError(result.error)
    return { configs: result.value.map(toConfigListRecord) }
  }, {
    detail: protectedRouteDetail('List config records')
  })
  // 单条配置详情返回 payload 供控制面确认，但 payload 已由草稿边界禁止明文 secret。
  .get('/:id', async ({ params, headers }) => {
    const auth = await requireConfiguredPermission(deps, { headers, action: 'config:read' })
    const result = await deps.config.get(params.id)
    if (!result.ok) throwConfigError(result.error, auth.correlationId)
    if (!result.value) throw new CoreError(404, 'config.not_found', 'config record not found', auth.correlationId)
    return { config: toConfigDetailRecord(result.value) }
  }, {
    params: configParamsSchema,
    detail: protectedRouteDetail('Show one config record')
  })
  // 草稿创建只做本地权限与明文 secret 拦截，不写 Audit，避免把配置编辑误归类为高风险发布事实。
  .post('/drafts', async ({ body, headers, set }) => {
    const auth = await requireConfiguredPermission(deps, { headers, action: 'config:draft' })
    if (containsPlaintextSecret(body.payload)) {
      throw new CoreError(400, 'config.secret_plaintext_rejected', 'config payload contains plaintext secret values; use secretRef', auth.correlationId)
    }
    const result = await deps.config.draft({
      domain: body.domain,
      payload: body.payload,
      ...(body.targetScope ? { targetScope: body.targetScope } : {}),
      correlationId: auth.correlationId
    })
    if (!result.ok) throwConfigError(result.error, auth.correlationId)
    set.status = 201
    return { config: result.value }
  }, {
    body: configDraftBodySchema,
    detail: protectedRouteDetail('Create config draft')
  })
  // validate 是中风险生命周期转换：需要 actor 具备 config:validate，但不强依赖 Audit 可用性。
  .post('/:id/validate', async ({ params, headers }) => {
    const auth = await requireConfiguredPermission(deps, { headers, action: 'config:validate' })
    const result = await deps.config.validate(params.id)
    if (!result.ok) throwConfigError(result.error, auth.correlationId)
    return { config: { id: result.value.id, status: result.value.status as 'validated' } }
  }, {
    params: configParamsSchema,
    detail: protectedRouteDetail('Validate config record')
  })
  // publish 是高风险控制面突变：必须先 M-Policy allow，再写 Audit，最后才调用 ConfigPort 突变。
  .post('/:id/publish', async ({ params, body, headers }) => {
    const { auth, decision } = await requireConfigPolicy(deps, {
      headers,
      action: 'config:publish',
      resource: `config:${params.id}`
    })
    await writeConfigAudit(deps, {
      actor: auth.actor,
      action: 'config:publish',
      resource: `config:${params.id}`,
      decisionId: decision.id,
      result: decision.result,
      correlationId: auth.correlationId,
      payload: { reason: body.reason }
    })
    const result = await deps.config.publish(params.id, { reason: body.reason, correlationId: auth.correlationId })
    if (!result.ok) throwConfigError(result.error, auth.correlationId)
    return { config: { ...result.value, status: result.value.status as 'published' } }
  }, {
    params: configParamsSchema,
    body: configPublishBodySchema,
    detail: protectedRouteDetail('Publish config record')
  })
  // rollback 与 publish 共享 fail-closed 顺序，确保回退意图在任何状态变更前已形成 Audit 事实。
  .post('/:id/rollback', async ({ params, body, headers }) => {
    const { auth, decision } = await requireConfigPolicy(deps, {
      headers,
      action: 'config:rollback',
      resource: `config:${params.id}`
    })
    await writeConfigAudit(deps, {
      actor: auth.actor,
      action: 'config:rollback',
      resource: `config:${params.id}`,
      decisionId: decision.id,
      result: decision.result,
      correlationId: auth.correlationId,
      payload: { toVersion: body.toVersion, reason: body.reason }
    })
    const result = await deps.config.rollback(params.id, {
      toVersion: body.toVersion,
      reason: body.reason,
      correlationId: auth.correlationId
    })
    if (!result.ok) throwConfigError(result.error, auth.correlationId)
    return { config: { id: result.value.id, status: result.value.status as 'rolled_back' } }
  }, {
    params: configParamsSchema,
    body: configRollbackBodySchema,
    detail: protectedRouteDetail('Rollback config record')
  })

/**
 * Internal apply-ack 只信任内部 token，并把领域服务回执转换为 ConfigPort 的统一 ack 输入。
 */
export const configApplyAck = (deps: CoreDeps) => new Elysia({ prefix: '/internal/v0/configs' })
  .post('/:id/apply-ack', async ({ params, body, headers, request }) => {
    const correlationId = correlationIdFromHeader(headers['x-correlation-id'])
    validateConfigInternalRequest(request, correlationId)
    const ackInput = normalizeAckInput(body)
    const result = await deps.config.applyAck(params.id, {
      version: ackInput.version,
      targetService: ackInput.targetService,
      status: ackInput.status,
      ...(ackInput.error ? { error: ackInput.error } : {}),
      correlationId
    })
    if (!result.ok) throwConfigError(result.error, correlationId)

    return {
      ack: {
        ackId: result.value.ackId,
        configId: params.id,
        configVersion: ackInput.version,
        ackedBy: ackInput.targetService,
        status: result.value.status as AckStatus,
        ackedAt: result.value.ackedAt,
        ...(body.errorCode ? { errorCode: redactSecrets(body.errorCode) } : {}),
        ...(body.errorMessage ? { errorMessage: redactSecrets(body.errorMessage) } : {})
      }
    }
  }, {
    params: configParamsSchema,
    body: configApplyAckBodySchema,
    detail: { summary: 'Internal config apply acknowledgement' }
  })
