import { extractBearerToken } from '../../../../packages/auth/src/index.ts'
import type { Permission } from '../../../../packages/contracts/src/index.ts'
import { CoreError } from '../core-error.ts'
import { authorize, requireActor } from '../middleware/auth.ts'
import { statusCodeForServiceError } from '../middleware/route-support.ts'
import type { CoreDeps } from '../types.ts'

type ServiceErrorLike = { code: string; message: string }

export type FacadeServiceResult<T> = { ok: true; value: T } | { ok: false; error: ServiceErrorLike }

export type FacadeAuth = Awaited<ReturnType<typeof requireActor>>
export type FacadeWriterContext = ReturnType<typeof facadeContext>

/** facade 写入上下文只透传 actor、Bearer token 与关联 ID，避免每个路由重复拼接。 */
export function facadeContext(auth: FacadeAuth, headers: Record<string, string | undefined>) {
  return {
    actor: auth.actor,
    bearerToken: facadeBearerTokenOrThrow(headers, auth.correlationId),
    correlationId: auth.correlationId
  }
}

/** facade 公开读入口统一复用 auth/context/result unwrap，避免每个路由重复样板。 */
export async function runFacadeRead<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
    run: (auth: FacadeAuth, ctx: FacadeWriterContext) => Promise<FacadeServiceResult<T>>
  }
): Promise<T> {
  const auth = await requireFacadeAccess(deps, {
    headers: input.headers,
    action: input.action,
    resource: input.resource
  })
  return unwrapFacadeResult(
    await input.run(auth, facadeContext(auth, input.headers)),
    auth.correlationId
  )
}

/** 详情读取有时允许下游返回 null；该 helper 保留 correlationId 供 404 转换使用。 */
export async function runFacadeMaybeRead<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
    run: (auth: FacadeAuth, ctx: FacadeWriterContext) => Promise<FacadeServiceResult<T | null>>
  }
): Promise<{ value: T | null; correlationId: string }> {
  const auth = await requireFacadeAccess(deps, {
    headers: input.headers,
    action: input.action,
    resource: input.resource
  })
  return {
    value: unwrapFacadeResult(
      await input.run(auth, facadeContext(auth, input.headers)),
      auth.correlationId
    ),
    correlationId: auth.correlationId
  }
}

/** 详情读取若下游返回 null，则在 support 层统一转成显式 404，避免每个路由重复 null 分支。 */
export async function runFacadeRequiredRead<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
    notFound: { code: string; message: string }
    run: (auth: FacadeAuth, ctx: FacadeWriterContext) => Promise<FacadeServiceResult<T | null>>
  }
): Promise<T> {
  const { value, correlationId } = await runFacadeMaybeRead(deps, input)
  if (value === null) {
    missingFacadeResource(correlationId, input.notFound.code, input.notFound.message)
  }
  return value
}

/** facade 写入口与公开读入口共用 runner，只是命名上显式区分意图。 */
export async function runFacadeWrite<T>(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
    run: (auth: FacadeAuth, ctx: FacadeWriterContext) => Promise<FacadeServiceResult<T>>
  }
): Promise<T> {
  return runFacadeRead(deps, input)
}

/** 下游端口未接线时统一返回 feature.unavailable，避免 façade 路由成排复制 503 handler。 */
export function facadeFeatureUnavailable(message: string) {
  return { error: { code: 'feature.unavailable', message } }
}

export function facadeBearerTokenOrThrow(
  headers: Record<string, string | undefined>,
  correlationId: string
): string {
  const token = extractBearerToken(headers.authorization)
  if (!token) {
    throw new CoreError(401, 'auth.missing_token', 'Bearer token is required', correlationId)
  }
  return token
}

/** facade 读写都先经过同一套认证与策略校验，确保公开入口收敛为统一行为。 */
export async function requireFacadeAccess(
  deps: CoreDeps,
  input: {
    headers: Record<string, string | undefined>
    action: Permission
    resource: string
  }
): Promise<FacadeAuth> {
  const auth = await requireActor(deps, input.headers)
  await authorize(deps, {
    actor: auth.actor,
    action: input.action,
    resource: input.resource,
    correlationId: auth.correlationId
  })
  return auth
}

/** 下游 facade 端口统一复用 Core service-error → HTTP status 映射，避免每条路由重复 switch。 */
export function unwrapFacadeResult<T>(result: FacadeServiceResult<T>, correlationId: string): T {
  if (!result.ok) {
    throw new CoreError(
      statusCodeForServiceError(result.error.code),
      result.error.code,
      result.error.message,
      correlationId
    )
  }
  return result.value
}

export function missingFacadeResource(correlationId: string, code: string, message: string): never {
  throw new CoreError(404, code, message, correlationId)
}
