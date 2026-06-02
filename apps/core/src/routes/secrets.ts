import { Elysia, t } from 'elysia'
import type { ActorId, Permission } from '../../../../packages/contracts/src/index.ts'
import { redactSecretsInObject } from '../../../../packages/common/src/secret-redaction.ts'
import { internalTokenHeaderName, validateInternalRequest } from '../../../../packages/internal-http/src/index.ts'
import { CoreError } from '../core-error.ts'
import { requireActor, authorize } from '../middleware/auth.ts'
import { apiErrorSchema, protectedRouteDetail } from '../schemas.ts'
import type { CoreDeps, ServiceError } from '../types.ts'

type SecretMetadata = Record<string, string>

type SecretListRecord = {
  id: string
  name: string
  scope: string
  status: string
  createdBy: string
  createdAt: string
  metadata: SecretMetadata
}

type SecretDetailRecord = SecretListRecord & {
  updatedAt: string
}

type SecretCreateRecord = {
  id: string
  name: string
  status: string
  createdAt: string
}

type SecretRotateRecord = {
  id: string
  version: string
  status: string
  rotatedAt: string
}

type SecretDisableRecord = {
  id: string
  status: string
  disabledAt: string
}

type SecretReferenceRecord = {
  id: string
  currentVersion: string
  status: string
  metadata: SecretMetadata
}

const secretParamsSchema = t.Object({
  id: t.String({ minLength: 1 })
})

const secretMetadataSchema = t.Record(t.String(), t.String())

const secretListRecordSchema = t.Object({
  id: t.String(),
  name: t.String(),
  scope: t.String(),
  status: t.String(),
  createdBy: t.String(),
  createdAt: t.String(),
  metadata: secretMetadataSchema
})

const secretDetailRecordSchema = t.Object({
  ...secretListRecordSchema.properties,
  updatedAt: t.String()
})

const secretCreateBodySchema = t.Object({
  name: t.String({ minLength: 1 }),
  scope: t.Union([t.Literal('system'), t.Literal('service'), t.Literal('node')]),
  value: t.String({ minLength: 1 }),
  metadata: t.Optional(secretMetadataSchema)
})

const secretRotateBodySchema = t.Object({
  value: t.String({ minLength: 1 }),
  reason: t.String({ minLength: 1 })
})

const secretDisableBodySchema = t.Object({
  reason: t.String({ minLength: 1 })
})

const secretCreateRecordSchema = t.Object({
  id: t.String(),
  name: t.String(),
  status: t.String(),
  createdAt: t.String()
})

const secretRotateRecordSchema = t.Object({
  id: t.String(),
  version: t.String(),
  status: t.String(),
  rotatedAt: t.String()
})

const secretDisableRecordSchema = t.Object({
  id: t.String(),
  status: t.String(),
  disabledAt: t.String()
})

const secretReferenceRecordSchema = t.Object({
  id: t.String(),
  currentVersion: t.String(),
  status: t.String(),
  metadata: secretMetadataSchema
})

function secretErrorStatus(error: ServiceError): 404 | 409 | 500 {
  if (error.code === 'secret.not_found') return 404
  if (error.code === 'secret.invalid_state') return 409
  return 500
}

function redactSecretRecord<T extends Record<string, unknown>>(record: T): T {
  return redactSecretsInObject(record)
}

async function requireSecretPermission(
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

async function writeSecretAudit(
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
    payload: redactSecretRecord(input.payload)
  })

  if (!audit.ok) {
    throw new CoreError(503, audit.error.code, audit.error.message, input.correlationId)
  }
}

function validateSecretInternalRequest(headers: Record<string, string | undefined>, correlationId?: string) {
  const result = process.env.MERISTEM_INTERNAL_TOKEN
    ? validateInternalRequest(headers)
    : headers[internalTokenHeaderName]
      ? { ok: true as const }
      : { ok: false as const, error: { code: 'internal.unauthorized', message: 'invalid internal token' } }

  if (!result.ok) {
    const status = result.error.code === 'internal.unavailable' ? 503 : 401
    throw new CoreError(status, result.error.code, result.error.message, correlationId)
  }
}

async function assertSecretIsMutable(deps: CoreDeps, input: { id: string; correlationId: string; operation: 'rotate' | 'disable' }) {
  const current = await deps.secrets.get(input.id)
  if (!current.ok) {
    throw new CoreError(secretErrorStatus(current.error), current.error.code, current.error.message, input.correlationId)
  }
  if (current.value === null) {
    throw new CoreError(404, 'secret.not_found', 'secretRef not found', input.correlationId)
  }
  if (current.value.status === 'disabled') {
    throw new CoreError(409, 'secret.invalid_state', `disabled secretRef cannot be ${input.operation}d`, input.correlationId)
  }
}

/**
 * SecretRef v0.1 外部路由只暴露 metadata 与版本引用，高风险突变统一先认证、授权、写 Audit，再调用存储端口。
 */
export const secrets = (deps: CoreDeps) => new Elysia({ prefix: '/api/v0/secrets' })
  // 读取 metadata 仍走 M-Policy，避免低权限 actor 枚举 secretRef 名称和作用域。
  .get('/', async ({ headers }) => {
    const { auth } = await requireSecretPermission(deps, {
      headers,
      action: 'secret:read-metadata',
      resource: 'secret:*'
    })

    const result = await deps.secrets.list()
    if (!result.ok) {
      throw new CoreError(500, result.error.code, result.error.message, auth.correlationId)
    }

    return result.value.map((secret): SecretListRecord => redactSecretRecord(secret))
  }, {
    response: {
      200: t.Array(secretListRecordSchema),
      401: apiErrorSchema,
      403: apiErrorSchema,
      500: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: protectedRouteDetail('List secretRef metadata')
  })
  // 单个 secretRef 详情只返回元数据；底层若错误或返回敏感字段，边界层仍统一再 redaction。
  .get('/:id', async ({ params, headers }) => {
    const { auth } = await requireSecretPermission(deps, {
      headers,
      action: 'secret:read-metadata',
      resource: `secret:${params.id}`
    })

    const result = await deps.secrets.get(params.id)
    if (!result.ok) {
      throw new CoreError(secretErrorStatus(result.error), result.error.code, result.error.message, auth.correlationId)
    }
    if (result.value === null) {
      throw new CoreError(404, 'secret.not_found', 'secretRef not found', auth.correlationId)
    }

    return redactSecretRecord(result.value) as SecretDetailRecord
  }, {
    params: secretParamsSchema,
    response: {
      200: secretDetailRecordSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      404: apiErrorSchema,
      500: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: protectedRouteDetail('Show secretRef metadata')
  })
  // create 接收明文只用于写入端口；Audit payload 与响应都不包含 value，防止请求明文回流到日志或客户端。
  .post('/', async ({ body, headers, set }) => {
    const { auth, decision } = await requireSecretPermission(deps, {
      headers,
      action: 'secret:create',
      resource: `secret:${body.name}`
    })

    await writeSecretAudit(deps, {
      actor: auth.actor,
      action: 'secret:create',
      resource: `secret:${body.name}`,
      decisionId: decision.id,
      result: decision.result,
      correlationId: auth.correlationId,
      payload: { name: body.name, scope: body.scope, metadata: body.metadata ?? {} }
    })

    const created = await deps.secrets.create({
      name: body.name,
      scope: body.scope,
      value: body.value,
      ...(body.metadata ? { metadata: body.metadata } : {}),
      correlationId: auth.correlationId
    })
    if (!created.ok) {
      throw new CoreError(500, created.error.code, created.error.message, auth.correlationId)
    }

    set.status = 201
    return redactSecretRecord(created.value) as SecretCreateRecord
  }, {
    body: secretCreateBodySchema,
    response: {
      201: secretCreateRecordSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      500: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: protectedRouteDetail('Create a secretRef')
  })
  // rotate 只把新值交给 SecretRefPort；审计记录 reason 与 decision，不记录旧值或新值。
  .post('/:id/rotate', async ({ params, body, headers }) => {
    const { auth, decision } = await requireSecretPermission(deps, {
      headers,
      action: 'secret:rotate',
      resource: `secret:${params.id}`
    })

    await writeSecretAudit(deps, {
      actor: auth.actor,
      action: 'secret:rotate',
      resource: `secret:${params.id}`,
      decisionId: decision.id,
      result: decision.result,
      correlationId: auth.correlationId,
      payload: { reason: body.reason }
    })

    await assertSecretIsMutable(deps, { id: params.id, correlationId: auth.correlationId, operation: 'rotate' })

    const rotated = await deps.secrets.rotate(params.id, {
      value: body.value,
      reason: body.reason,
      correlationId: auth.correlationId
    })
    if (!rotated.ok) {
      throw new CoreError(secretErrorStatus(rotated.error), rotated.error.code, rotated.error.message, auth.correlationId)
    }

    return redactSecretRecord(rotated.value) as SecretRotateRecord
  }, {
    params: secretParamsSchema,
    body: secretRotateBodySchema,
    response: {
      200: secretRotateRecordSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      404: apiErrorSchema,
      500: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: protectedRouteDetail('Rotate a secretRef')
  })
  // disable 与 rotate 一样先落 Audit 再突变，保证禁用操作即使后续失败也有可追踪控制面事实。
  .post('/:id/disable', async ({ params, body, headers }) => {
    const { auth, decision } = await requireSecretPermission(deps, {
      headers,
      action: 'secret:disable',
      resource: `secret:${params.id}`
    })

    await writeSecretAudit(deps, {
      actor: auth.actor,
      action: 'secret:disable',
      resource: `secret:${params.id}`,
      decisionId: decision.id,
      result: decision.result,
      correlationId: auth.correlationId,
      payload: { reason: body.reason }
    })

    await assertSecretIsMutable(deps, { id: params.id, correlationId: auth.correlationId, operation: 'disable' })

    const disabled = await deps.secrets.disable(params.id, {
      reason: body.reason,
      correlationId: auth.correlationId
    })
    if (!disabled.ok) {
      throw new CoreError(secretErrorStatus(disabled.error), disabled.error.code, disabled.error.message, auth.correlationId)
    }

    return redactSecretRecord(disabled.value) as SecretDisableRecord
  }, {
    params: secretParamsSchema,
    body: secretDisableBodySchema,
    response: {
      200: secretDisableRecordSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      404: apiErrorSchema,
      500: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: protectedRouteDetail('Disable a secretRef')
  })

/**
 * 内部 reference 路由只返回 metadata 与当前版本号，并且复用 Bearer + M-Policy，避免内部调用绕过 secret:reference 权限。
 */
export const secretReference = (deps: CoreDeps) => new Elysia({ prefix: '/internal/v0/secrets' })
  .post('/:id/reference', async ({ params, headers }) => {
    validateSecretInternalRequest(headers)

    const result = await deps.secrets.reference(params.id)
    if (!result.ok) {
      throw new CoreError(secretErrorStatus(result.error), result.error.code, result.error.message)
    }

    return redactSecretRecord(result.value) as SecretReferenceRecord
  }, {
    params: secretParamsSchema,
    response: {
      200: secretReferenceRecordSchema,
      401: apiErrorSchema,
      403: apiErrorSchema,
      404: apiErrorSchema,
      500: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: protectedRouteDetail('Resolve internal secretRef metadata')
  })
  // 该内部路径不是正式突变接口；保留认证门禁让缺少 internal token 的调用 fail-closed，而不是落入 404。
  .post('/:id/disable', async ({ headers }) => {
    validateSecretInternalRequest(headers)
    throw new CoreError(404, 'secret.internal_route_not_found', 'internal secret disable route is not available')
  }, {
    params: secretParamsSchema,
    response: {
      401: apiErrorSchema,
      404: apiErrorSchema,
      503: apiErrorSchema
    },
    detail: { summary: 'Reject unsupported internal secretRef disable route' }
  })

export const secretsRoutes = secrets
