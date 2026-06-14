import { Elysia, t } from 'elysia'
import { extensionPermission } from '../../../packages/contracts/src/literals.ts'
import type {
  DisableExtensionRequest,
  EnableExtensionRequest,
  RegisterExtensionRequest
} from '../../../packages/contracts/src/types/extension.ts'
import {
  mExtensionApiRoutes,
  mExtensionEventSubjects,
  mExtensionEventTypes,
  mExtensionResource,
  mExtensionScope,
  mExtensionServiceName
} from '../../../packages/contracts/src/types/extension.ts'
import { withExtractedSpan } from '../../../packages/telemetry/src/index.ts'
import type { MExtensionDeps } from './deps.ts'
import {
  controlBodySchema,
  definitionSchema,
  errorSchema,
  extensionPairSchema,
  instanceSchema,
  registerBodySchema
} from './route-schemas.ts'
import {
  assertSystemDefault,
  auditBeforeMutation,
  authorize,
  lifecyclePayload,
  publishLifecycle,
  readStore,
  requireActor,
  validateManifestOrReject
} from './route-helpers.ts'

/**
 * 生命周期路由必须保持 register / enable / disable 的策略、审计、存储、Timeline、事件顺序不变。
 */
export function createExtensionLifecycleRoutes(deps: MExtensionDeps) {
  return new Elysia()
    .post(
      mExtensionApiRoutes.register,
      async ({ body, headers }) => {
        const auth = await requireActor(headers, deps.jwtSecret)
        return withExtractedSpan(
          mExtensionServiceName,
          `${mExtensionServiceName}.extension.register`,
          headers,
          async () => {
            const request = body as RegisterExtensionRequest
            const manifest = await validateManifestOrReject(deps, auth, request.manifest)
            const resource = `${mExtensionResource.prefix}:${manifest.id}`
            const decision = await authorize(deps, auth, extensionPermission.register, resource)
            await auditBeforeMutation(deps, {
              auth,
              action: mExtensionEventTypes.definitionRegistered,
              resource,
              decisionId: decision.id,
              payload: {
                riskClass: manifest.riskClass,
                requestedPermissions: manifest.requestedPermissions
              }
            })
            const registered = await readStore(auth.correlationId, () =>
              deps.store.register({
                manifest,
                actor: auth.actor,
                policyDecisionId: decision.id,
                correlationId: auth.correlationId
              })
            )
            await deps.log.writeTimeline(
              `registered extension ${registered.definition.id}`,
              registered.definition.id,
              auth.correlationId
            )
            await publishLifecycle(deps, {
              subject: mExtensionEventSubjects.definitionRegistered,
              type: mExtensionEventTypes.definitionRegistered,
              payload: lifecyclePayload({
                definition: registered.definition,
                actor: auth.actor,
                decisionId: decision.id,
                ...(request.reason ? { reason: request.reason } : {}),
                correlationId: auth.correlationId
              }),
              correlationId: auth.correlationId,
              failureCode: 'extension.event_publish_failed'
            })
            return Response.json({
              ...registered,
              policyDecisionId: decision.id,
              correlationId: auth.correlationId
            })
          }
        )
      },
      {
        body: registerBodySchema,
        response: {
          200: t.Intersect([
            extensionPairSchema,
            t.Object({ policyDecisionId: t.String(), correlationId: t.String() })
          ]),
          401: errorSchema,
          403: errorSchema,
          409: errorSchema,
          503: errorSchema
        }
      }
    )
    .post(
      mExtensionApiRoutes.enable,
      async ({ body, headers, params }) => {
        const auth = await requireActor(headers, deps.jwtSecret)
        return withExtractedSpan(
          mExtensionServiceName,
          `${mExtensionServiceName}.extension.enable`,
          headers,
          async () => {
            const request = body as EnableExtensionRequest
            assertSystemDefault(request, auth.correlationId)
            const existing = await readStore(auth.correlationId, () => deps.store.get(params.id))
            if (!existing)
              throw Object.assign(new Error('extension not found'), {
                status: 404,
                code: 'extension.not_found',
                correlationId: auth.correlationId
              })

            const resource = `${mExtensionResource.prefix}:${params.id}`
            const decision = await authorize(deps, auth, extensionPermission.enable, resource)
            await auditBeforeMutation(deps, {
              auth,
              action: mExtensionEventTypes.instanceEnabled,
              resource,
              decisionId: decision.id,
              payload: { scopeType: mExtensionScope.type, scopeId: mExtensionScope.id }
            })
            const enabled = await readStore(auth.correlationId, () =>
              deps.store.enable({
                extensionId: params.id,
                actor: auth.actor,
                ...(request.reason ? { reason: request.reason } : {}),
                policyDecisionId: decision.id,
                correlationId: auth.correlationId
              })
            )
            if (!enabled)
              throw Object.assign(new Error('extension not found'), {
                status: 404,
                code: 'extension.not_found',
                correlationId: auth.correlationId
              })

            await deps.log.writeTimeline(
              `enabled extension ${params.id}`,
              params.id,
              auth.correlationId
            )
            await publishLifecycle(deps, {
              subject: mExtensionEventSubjects.instanceEnabled,
              type: mExtensionEventTypes.instanceEnabled,
              payload: lifecyclePayload({
                definition: enabled.definition,
                actor: auth.actor,
                decisionId: decision.id,
                ...(request.reason ? { reason: request.reason } : {}),
                correlationId: auth.correlationId
              }),
              correlationId: auth.correlationId,
              failureCode: 'extension.event_publish_failed',
              failureSubject: mExtensionEventSubjects.instanceEnableFailed,
              failureType: mExtensionEventTypes.instanceEnableFailed
            })
            return Response.json({
              ...enabled,
              policyDecisionId: decision.id,
              correlationId: auth.correlationId
            })
          }
        )
      },
      {
        body: controlBodySchema,
        response: {
          200: t.Object({
            definition: definitionSchema,
            instance: instanceSchema,
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          503: errorSchema
        }
      }
    )
    .post(
      mExtensionApiRoutes.disable,
      async ({ body, headers, params }) => {
        const auth = await requireActor(headers, deps.jwtSecret)
        return withExtractedSpan(
          mExtensionServiceName,
          `${mExtensionServiceName}.extension.disable`,
          headers,
          async () => {
            const request = body as DisableExtensionRequest
            assertSystemDefault(request, auth.correlationId)
            const existing = await readStore(auth.correlationId, () => deps.store.get(params.id))
            if (!existing)
              throw Object.assign(new Error('extension not found'), {
                status: 404,
                code: 'extension.not_found',
                correlationId: auth.correlationId
              })

            const resource = `${mExtensionResource.prefix}:${params.id}`
            const decision = await authorize(deps, auth, extensionPermission.disable, resource)
            await auditBeforeMutation(deps, {
              auth,
              action: mExtensionEventTypes.instanceDisabled,
              resource,
              decisionId: decision.id,
              payload: { scopeType: mExtensionScope.type, scopeId: mExtensionScope.id }
            })
            const disabled = await readStore(auth.correlationId, () =>
              deps.store.disable({
                extensionId: params.id,
                actor: auth.actor,
                ...(request.reason ? { reason: request.reason } : {}),
                policyDecisionId: decision.id,
                correlationId: auth.correlationId
              })
            )
            if (!disabled)
              throw Object.assign(new Error('extension not found'), {
                status: 404,
                code: 'extension.not_found',
                correlationId: auth.correlationId
              })

            await deps.log.writeTimeline(
              `disabled extension ${params.id}`,
              params.id,
              auth.correlationId
            )
            await publishLifecycle(deps, {
              subject: mExtensionEventSubjects.instanceDisabled,
              type: mExtensionEventTypes.instanceDisabled,
              payload: lifecyclePayload({
                definition: disabled.definition,
                actor: auth.actor,
                decisionId: decision.id,
                ...(request.reason ? { reason: request.reason } : {}),
                correlationId: auth.correlationId
              }),
              correlationId: auth.correlationId,
              failureCode: 'extension.event_publish_failed',
              failureSubject: mExtensionEventSubjects.instanceDisableFailed,
              failureType: mExtensionEventTypes.instanceDisableFailed
            })
            return Response.json({
              ...disabled,
              policyDecisionId: decision.id,
              correlationId: auth.correlationId
            })
          }
        )
      },
      {
        body: controlBodySchema,
        response: {
          200: t.Object({
            definition: definitionSchema,
            instance: instanceSchema,
            policyDecisionId: t.String(),
            correlationId: t.String()
          }),
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          503: errorSchema
        }
      }
    )
}
