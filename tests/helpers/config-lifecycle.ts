import type { createCoreApp } from '../../apps/core/src/app.ts'

type ConfigLifecycleApp = ReturnType<typeof createCoreApp>

/** 为配置生命周期测试构造 Bearer 请求头。 */
export function bearerHeaders(actor: string): Record<string, string> {
  return {
    authorization: `Bearer ${actor}-token`,
    'content-type': 'application/json'
  }
}

/** 为内部 apply-ack 路由构造内部调用头。 */
export function internalHeaders(): Record<string, string> {
  process.env.MERISTEM_INTERNAL_TOKEN = process.env.MERISTEM_INTERNAL_TOKEN ?? 'test-internal-token'
  return {
    'x-meristem-internal-token': process.env.MERISTEM_INTERNAL_TOKEN,
    'content-type': 'application/json'
  }
}

/** 构造默认合法的配置草稿负载。 */
export function validDraftPayload(overrides?: Record<string, unknown>) {
  return {
    domain: 'core' as const,
    targetScope: ['m-net'],
    payload: {
      opentelemetry: { enabled: true, endpoint: 'http://otel:4317' }
    },
    ...overrides
  }
}

/** 发送配置草稿创建请求。 */
export async function draftConfig(
  app: ConfigLifecycleApp,
  token: string,
  overrides?: Record<string, unknown>
) {
  return app.handle(
    new Request('http://localhost/api/v0/configs/drafts', {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify(validDraftPayload(overrides))
    })
  )
}

/** 发送配置发布请求。 */
export async function publishConfig(
  app: ConfigLifecycleApp,
  configId: string,
  token: string,
  reason = 'CFG-FM smoke publish'
) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}/publish`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ reason })
    })
  )
}

/** 发送配置回滚请求。 */
export async function rollbackConfig(
  app: ConfigLifecycleApp,
  configId: string,
  toVersion: string,
  token: string,
  reason = 'CFG-FM smoke rollback'
) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}/rollback`, {
      method: 'POST',
      headers: bearerHeaders(token),
      body: JSON.stringify({ toVersion, reason })
    })
  )
}

/** 读取单个配置。 */
export async function getConfig(app: ConfigLifecycleApp, configId: string, token: string) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}`, {
      headers: bearerHeaders(token)
    })
  )
}

/** 校验配置草稿。 */
export async function validateConfig(app: ConfigLifecycleApp, configId: string, token: string) {
  return app.handle(
    new Request(`http://localhost/api/v0/configs/${configId}/validate`, {
      method: 'POST',
      headers: bearerHeaders(token)
    })
  )
}

/** 提交内部 apply-ack。 */
export async function submitApplyAck(
  app: ConfigLifecycleApp,
  configId: string,
  configVersion: string,
  ack: {
    ackedBy: string
    status: 'acked' | 'failed' | 'pending'
    errorCode?: string
    errorMessage?: string
  }
) {
  return app.handle(
    new Request(`http://localhost/internal/v0/configs/${configId}/apply-ack`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify({ ...ack, configVersion, targetService: ack.ackedBy })
    })
  )
}

/** 创建、校验并发布一个配置，供状态流测试复用。 */
export async function setupPublishedConfig(
  app: ConfigLifecycleApp,
  token: string,
  options?: { domain?: string; targetScope?: string[] }
): Promise<{ id: string; configVersion: string }> {
  const draft = await draftConfig(app, token, options)
  if (draft.status !== 201) {
    const body = (await draft.json()) as { error?: { message: string } }
    throw new Error(`draft failed: ${body.error?.message ?? draft.status}`)
  }
  const draftBody = (await draft.json()) as { config: { id: string; configVersion: string } }

  const validation = await validateConfig(app, draftBody.config.id, token)
  if (validation.status !== 200) throw new Error(`validate failed: ${validation.status}`)

  const publish = await publishConfig(app, draftBody.config.id, token)
  if (publish.status !== 200) throw new Error(`publish failed: ${publish.status}`)

  return { id: draftBody.config.id, configVersion: draftBody.config.configVersion }
}
