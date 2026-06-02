import { Elysia, t } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { extractBearerToken, verifyLocalToken } from '../../../packages/auth/src/index.ts'
import { extensionPermission, type ActorId, type Permission } from '../../../packages/contracts/src/literals.ts'
import { validateInternalRequest } from '../../../packages/internal-http/src/index.ts'
import type {
  DisableExtensionRequest,
  EnableExtensionRequest,
  MExtensionDefinition,
  MExtensionLifecyclePayload,
  RegisterExtensionRequest
} from '../../../packages/contracts/src/types/extension.ts'
import {
  mExtensionApiRoutes,
  mExtensionApiVersion,
  mExtensionEventSubjects,
  mExtensionEventTypes,
  mExtensionManifestVersion,
  mExtensionResource,
  mExtensionScope,
  mExtensionServiceName
} from '../../../packages/contracts/src/types/extension.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import { validateExtensionManifest } from './manifest.ts'
import type { ExtensionStore } from './store.ts'

export type MExtensionError = { code: string; message: string }
export type PolicyDecisionResult = 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
export type MExtensionPolicyDecision = { result: PolicyDecisionResult; id: string; reasons: string[] }

export type MExtensionDeps = {
  jwtSecret: string
  store: ExtensionStore
  policy: {
    authorize(actor: ActorId, action: Permission, resource: string): Promise<MExtensionPolicyDecision>
  }
  log: {
    writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void>
    writeFull(level: 'debug' | 'info' | 'warn' | 'error', message: string, correlationId?: string, payload?: unknown): Promise<void>
    writeAudit(actor: ActorId, action: string, resource: string, result: string, correlationId: string, payload: unknown): Promise<void>
  }
  events: {
    publish(subject: string, type: string, payload: MExtensionLifecyclePayload, correlationId?: string): Promise<void>
  }
  readiness(): Promise<{ ready: boolean }>
}

type AuthContext = { actor: ActorId; correlationId: string }

const errorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
    correlationId: t.Optional(t.String())
  })
})

const manifestSchema = t.Object({
  id: t.String(),
  manifestVersion: t.Literal(mExtensionManifestVersion),
  displayName: t.String(),
  description: t.Optional(t.String()),
  kind: t.Union([t.Literal('metadata-only'), t.Literal('webhook-declared'), t.Literal('wasm-placeholder'), t.Literal('http-callback-placeholder')]),
  owner: t.String(),
  license: t.String(),
  declaredCapabilities: t.Array(t.String()),
  requestedPermissions: t.Array(t.String()),
  configSchemaRef: t.Optional(t.String()),
  requestedEvents: t.Optional(t.Array(t.String())),
  emittedEvents: t.Optional(t.Array(t.String())),
  riskClass: t.Union([t.Literal('low'), t.Literal('medium')]),
  lifecycleStatus: t.Union([t.Literal('draft'), t.Literal('active'), t.Literal('deprecated')]),
  controlPlaneOnly: t.Literal(true),
  futureEntrypoint: t.Optional(t.String()),
  futureRuntime: t.Optional(t.String()),
  futureWebhookVerification: t.Optional(t.String()),
  futureResourceLimits: t.Optional(t.Record(t.String(), t.Unknown())),
  createdAt: t.Optional(t.String()),
  updatedAt: t.Optional(t.String())
})
const registerManifestSchema = t.Object({
  ...manifestSchema.properties,
  kind: t.String(),
  riskClass: t.String(),
  futureResourceLimits: t.Optional(t.Record(t.String(), t.Unknown()))
})

const instanceSchema = t.Object({
  id: t.String(),
  extensionId: t.String(),
  scopeType: t.Literal(mExtensionScope.type),
  scopeId: t.Literal(mExtensionScope.id),
  status: t.Union([t.Literal('disabled'), t.Literal('enabled'), t.Literal('enable_failed'), t.Literal('disable_failed')]),
  enabledBy: t.Optional(t.String()),
  disabledBy: t.Optional(t.String()),
  policyDecisionId: t.Optional(t.String()),
  correlationId: t.Optional(t.String()),
  lastError: t.Optional(t.String()),
  createdAt: t.String(),
  updatedAt: t.String(),
  enabledAt: t.Optional(t.String()),
  disabledAt: t.Optional(t.String())
})

const definitionSchema = t.Object({
  id: t.String(),
  manifestVersion: t.Literal(mExtensionManifestVersion),
  kind: t.Union([t.Literal('metadata-only'), t.Literal('webhook-declared'), t.Literal('wasm-placeholder'), t.Literal('http-callback-placeholder')]),
  displayName: t.String(),
  owner: t.String(),
  license: t.String(),
  manifest: manifestSchema,
  declaredCapabilities: t.Array(t.String()),
  requestedPermissions: t.Array(t.String()),
  riskClass: t.Union([t.Literal('low'), t.Literal('medium')]),
  status: t.Union([t.Literal('registered'), t.Literal('rejected'), t.Literal('deprecated')]),
  registeredBy: t.String(),
  policyDecisionId: t.String(),
  correlationId: t.String(),
  createdAt: t.String(),
  updatedAt: t.String()
})

const extensionPairSchema = t.Object({ definition: definitionSchema, instance: t.Optional(instanceSchema) })
const registerBodySchema = t.Object({ manifest: registerManifestSchema, reason: t.Optional(t.String()) })
const controlBodySchema = t.Object({ scopeType: t.Optional(t.String()), scopeId: t.Optional(t.String()), reason: t.Optional(t.String()) })

function correlationIdFromHeaders(headers: Record<string, string | undefined>): string {
  const value = headers['x-correlation-id']
  return value && value.trim().length > 0 ? value : crypto.randomUUID()
}

function raise(status: number, code: string, message: string, correlationId?: string): never {
  throw Object.assign(new Error(message), { status, code, correlationId })
}

async function requireActor(headers: Record<string, string | undefined>, jwtSecret: string): Promise<AuthContext> {
  const correlationId = correlationIdFromHeaders(headers)
  const token = extractBearerToken(headers.authorization)
  if (!token) throw Object.assign(new Error('Bearer token is required'), { status: 401, code: 'auth.missing_token', correlationId })
  const verified = await verifyLocalToken({ token, secret: jwtSecret })
  if (!verified.ok) throw Object.assign(new Error(verified.message), { status: 401, code: verified.code, correlationId })
  return { actor: verified.actor, correlationId }
}

async function authorize(deps: MExtensionDeps, auth: AuthContext, action: Permission, resource: string): Promise<MExtensionPolicyDecision> {
  let decision: MExtensionPolicyDecision
  try {
    decision = await deps.policy.authorize(auth.actor, action, resource)
  } catch {
    raise(503, 'policy.unavailable', 'M-Policy unavailable', auth.correlationId)
  }
  if (decision.result === 'allow') return decision
  await deps.log.writeFull('warn', `policy blocked ${action}`, auth.correlationId, { actor: auth.actor, resource, decisionId: decision.id, result: decision.result })
  if (action !== extensionPermission.read) {
    await writeAuditFailClosed(deps, { auth, action, resource, result: 'deny', payload: { decisionId: decision.id, reasons: decision.reasons } })
  }
  throw Object.assign(new Error(`permission denied for ${action}`), { status: 403, code: 'policy.denied', correlationId: auth.correlationId, decisionId: decision.id })
}

function assertSystemDefault(body: EnableExtensionRequest | DisableExtensionRequest, correlationId: string): void {
  if ((body.scopeType && body.scopeType !== mExtensionScope.type) || (body.scopeId && body.scopeId !== mExtensionScope.id)) {
    throw Object.assign(new Error(`Phase 15 supports only ${mExtensionScope.type}/${mExtensionScope.id} extension instances`), { status: 409, code: 'extension.scope.unsupported', correlationId })
  }
}

function lifecyclePayload(input: { definition: MExtensionDefinition; actor: ActorId; decisionId: string; reason?: string | undefined; correlationId: string; errorCode?: string | undefined }): MExtensionLifecyclePayload {
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

async function auditBeforeMutation(deps: MExtensionDeps, input: { auth: AuthContext; action: string; resource: string; decisionId: string; payload: unknown }): Promise<void> {
  try {
    await deps.log.writeAudit(input.auth.actor, input.action, input.resource, 'allow', input.auth.correlationId, { decisionId: input.decisionId, payload: input.payload })
  } catch {
    raise(503, 'audit.unavailable', 'Audit Log unavailable', input.auth.correlationId)
  }
}

async function writeAuditFailClosed(deps: MExtensionDeps, input: { auth: AuthContext; action: string; resource: string; result: string; payload: unknown }): Promise<void> {
  try {
    await deps.log.writeAudit(input.auth.actor, input.action, input.resource, input.result, input.auth.correlationId, input.payload)
  } catch {
    raise(503, 'audit.unavailable', 'Audit Log unavailable', input.auth.correlationId)
  }
}

async function publishLifecycle(deps: MExtensionDeps, input: { subject: string; type: string; payload: MExtensionLifecyclePayload; correlationId: string; failureCode: string; failureSubject?: string; failureType?: string }): Promise<void> {
  try {
    await deps.events.publish(input.subject, input.type, input.payload, input.correlationId)
  } catch {
    await deps.log.writeFull('error', `failed to publish ${input.subject}`, input.correlationId, { errorCode: input.failureCode, extensionId: input.payload.extensionId })
    if (input.failureSubject && input.failureType) {
      await deps.events.publish(input.failureSubject, input.failureType, { ...input.payload, errorCode: input.failureCode }, input.correlationId).catch(() => undefined)
    }
    raise(503, input.failureCode, 'extension lifecycle event publication failed', input.correlationId)
  }
}

async function rejectManifest(deps: MExtensionDeps, auth: AuthContext, manifest: unknown, code: string, message: string): Promise<never> {
  const extensionId = typeof manifest === 'object' && manifest !== null && 'id' in manifest && typeof manifest.id === 'string' ? manifest.id : 'unknown'
  const resource = `${mExtensionResource.prefix}:${extensionId}`
  await deps.log.writeFull('warn', 'extension manifest validation failed', auth.correlationId, { code, actor: auth.actor, extensionId })
  if (code === 'extension.manifest.risk_unsupported') {
    await writeAuditFailClosed(deps, { auth, action: mExtensionEventTypes.definitionRejected, resource, result: 'rejected', payload: { errorCode: code } })
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

/**
 * M-Extension 外部 API 在每条路由显式串起 bearer auth、M-Policy、Audit-before-mutation、Timeline 和 lifecycle event。
  */
export function createMExtensionApp(deps: MExtensionDeps) {
  async function readStore<T>(correlationId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch {
      raise(503, 'extension.store_unavailable', 'Extension store unavailable', correlationId)
    }
  }

  return new Elysia()
    .onError(({ error, set }) => {
      const maybe = error as Error & { status?: number; code?: string; correlationId?: string }
      if (maybe.status && maybe.code) {
        set.status = maybe.status
        return { error: { code: maybe.code, message: maybe.message, correlationId: maybe.correlationId } }
      }
      return undefined
    })
    .use(swagger({ path: mExtensionApiRoutes.openapi, documentation: { info: { title: 'M-Extension API', version: mExtensionApiVersion } } }))
    .get(mExtensionApiRoutes.health, () => ({ ok: true as const, service: mExtensionServiceName }))
    .get(mExtensionApiRoutes.ready, async ({ headers, status }) => {
      const auth = validateInternalRequest(headers)
      if (!auth.ok) return status(401, { error: auth.error })
      return withExtractedSpan(mExtensionServiceName, `${mExtensionServiceName}.ready`, headers, () => deps.readiness())
    }, { response: { 200: t.Object({ ready: t.Boolean() }), 401: errorSchema } })
    .get(mExtensionApiRoutes.collection, async ({ headers }) => {
      const auth = await requireActor(headers, deps.jwtSecret)
      return withExtractedSpan(mExtensionServiceName, `${mExtensionServiceName}.extension.list`, headers, async () => {
        await authorize(deps, auth, extensionPermission.read, mExtensionResource.collection)
        return Response.json({ extensions: await readStore(auth.correlationId, () => deps.store.list()) })
      })
    }, { response: { 200: t.Object({ extensions: t.Array(extensionPairSchema) }), 401: errorSchema, 403: errorSchema } })
    .get(mExtensionApiRoutes.detail, async ({ headers, params }) => {
      const auth = await requireActor(headers, deps.jwtSecret)
      return withExtractedSpan(mExtensionServiceName, `${mExtensionServiceName}.extension.get`, headers, async () => {
        await authorize(deps, auth, extensionPermission.read, `${mExtensionResource.prefix}:${params.id}`)
        const extension = await readStore(auth.correlationId, () => deps.store.get(params.id))
        if (!extension) throw Object.assign(new Error('extension not found'), { status: 404, code: 'extension.not_found', correlationId: auth.correlationId })
        return Response.json(extension)
      })
    }, { response: { 200: extensionPairSchema, 401: errorSchema, 403: errorSchema, 404: errorSchema } })
    .post(mExtensionApiRoutes.register, async ({ body, headers }) => {
      const auth = await requireActor(headers, deps.jwtSecret)
      return withExtractedSpan(mExtensionServiceName, `${mExtensionServiceName}.extension.register`, headers, async () => {
        const request = body as RegisterExtensionRequest
        const validation = validateExtensionManifest(request.manifest)
        if (!validation.ok) {
          return await rejectManifest(deps, auth, request.manifest, validation.code, validation.message)
        }
        const manifest = validation.manifest
        const resource = `${mExtensionResource.prefix}:${manifest.id}`
        const decision = await authorize(deps, auth, extensionPermission.register, resource)
        await auditBeforeMutation(deps, { auth, action: mExtensionEventTypes.definitionRegistered, resource, decisionId: decision.id, payload: { riskClass: manifest.riskClass, requestedPermissions: manifest.requestedPermissions } })
        const registered = await readStore(auth.correlationId, () => deps.store.register({ manifest, actor: auth.actor, policyDecisionId: decision.id, correlationId: auth.correlationId }))
        await deps.log.writeTimeline(`registered extension ${registered.definition.id}`, registered.definition.id, auth.correlationId)
        await publishLifecycle(deps, { subject: mExtensionEventSubjects.definitionRegistered, type: mExtensionEventTypes.definitionRegistered, payload: lifecyclePayload({ definition: registered.definition, actor: auth.actor, decisionId: decision.id, ...(request.reason ? { reason: request.reason } : {}), correlationId: auth.correlationId }), correlationId: auth.correlationId, failureCode: 'extension.event_publish_failed' })
        return Response.json({ ...registered, policyDecisionId: decision.id, correlationId: auth.correlationId })
      })
    }, { body: registerBodySchema, response: { 200: t.Intersect([extensionPairSchema, t.Object({ policyDecisionId: t.String(), correlationId: t.String() })]), 401: errorSchema, 403: errorSchema, 409: errorSchema, 503: errorSchema } })
    .post(mExtensionApiRoutes.enable, async ({ body, headers, params }) => {
      const auth = await requireActor(headers, deps.jwtSecret)
      return withExtractedSpan(mExtensionServiceName, `${mExtensionServiceName}.extension.enable`, headers, async () => {
        const request = body as EnableExtensionRequest
        assertSystemDefault(request, auth.correlationId)
        const existing = await readStore(auth.correlationId, () => deps.store.get(params.id))
        if (!existing) throw Object.assign(new Error('extension not found'), { status: 404, code: 'extension.not_found', correlationId: auth.correlationId })
        const resource = `${mExtensionResource.prefix}:${params.id}`
        const decision = await authorize(deps, auth, extensionPermission.enable, resource)
        await auditBeforeMutation(deps, { auth, action: mExtensionEventTypes.instanceEnabled, resource, decisionId: decision.id, payload: { scopeType: mExtensionScope.type, scopeId: mExtensionScope.id } })
        const enabled = await readStore(auth.correlationId, () => deps.store.enable({ extensionId: params.id, actor: auth.actor, ...(request.reason ? { reason: request.reason } : {}), policyDecisionId: decision.id, correlationId: auth.correlationId }))
        if (!enabled) throw Object.assign(new Error('extension not found'), { status: 404, code: 'extension.not_found', correlationId: auth.correlationId })
        await deps.log.writeTimeline(`enabled extension ${params.id}`, params.id, auth.correlationId)
        await publishLifecycle(deps, { subject: mExtensionEventSubjects.instanceEnabled, type: mExtensionEventTypes.instanceEnabled, payload: lifecyclePayload({ definition: enabled.definition, actor: auth.actor, decisionId: decision.id, ...(request.reason ? { reason: request.reason } : {}), correlationId: auth.correlationId }), correlationId: auth.correlationId, failureCode: 'extension.event_publish_failed', failureSubject: mExtensionEventSubjects.instanceEnableFailed, failureType: mExtensionEventTypes.instanceEnableFailed })
        return Response.json({ ...enabled, policyDecisionId: decision.id, correlationId: auth.correlationId })
      })
    }, { body: controlBodySchema, response: { 200: t.Object({ definition: definitionSchema, instance: instanceSchema, policyDecisionId: t.String(), correlationId: t.String() }), 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema } })
    .post(mExtensionApiRoutes.disable, async ({ body, headers, params }) => {
      const auth = await requireActor(headers, deps.jwtSecret)
      return withExtractedSpan(mExtensionServiceName, `${mExtensionServiceName}.extension.disable`, headers, async () => {
        const request = body as DisableExtensionRequest
        assertSystemDefault(request, auth.correlationId)
        const existing = await readStore(auth.correlationId, () => deps.store.get(params.id))
        if (!existing) throw Object.assign(new Error('extension not found'), { status: 404, code: 'extension.not_found', correlationId: auth.correlationId })
        const resource = `${mExtensionResource.prefix}:${params.id}`
        const decision = await authorize(deps, auth, extensionPermission.disable, resource)
        await auditBeforeMutation(deps, { auth, action: mExtensionEventTypes.instanceDisabled, resource, decisionId: decision.id, payload: { scopeType: mExtensionScope.type, scopeId: mExtensionScope.id } })
        const disabled = await readStore(auth.correlationId, () => deps.store.disable({ extensionId: params.id, actor: auth.actor, ...(request.reason ? { reason: request.reason } : {}), policyDecisionId: decision.id, correlationId: auth.correlationId }))
        if (!disabled) throw Object.assign(new Error('extension not found'), { status: 404, code: 'extension.not_found', correlationId: auth.correlationId })
        await deps.log.writeTimeline(`disabled extension ${params.id}`, params.id, auth.correlationId)
        await publishLifecycle(deps, { subject: mExtensionEventSubjects.instanceDisabled, type: mExtensionEventTypes.instanceDisabled, payload: lifecyclePayload({ definition: disabled.definition, actor: auth.actor, decisionId: decision.id, ...(request.reason ? { reason: request.reason } : {}), correlationId: auth.correlationId }), correlationId: auth.correlationId, failureCode: 'extension.event_publish_failed', failureSubject: mExtensionEventSubjects.instanceDisableFailed, failureType: mExtensionEventTypes.instanceDisableFailed })
        return Response.json({ ...disabled, policyDecisionId: decision.id, correlationId: auth.correlationId })
      })
    }, { body: controlBodySchema, response: { 200: t.Object({ definition: definitionSchema, instance: instanceSchema, policyDecisionId: t.String(), correlationId: t.String() }), 401: errorSchema, 403: errorSchema, 404: errorSchema, 409: errorSchema, 503: errorSchema } })
}

export type MExtensionApp = ReturnType<typeof createMExtensionApp>
