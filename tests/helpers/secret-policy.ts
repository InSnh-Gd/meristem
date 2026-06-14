import type { createCoreApp } from '../../apps/core/src/app.ts'

type SecretPolicyApp = ReturnType<typeof createCoreApp>

/** 为 SecretRef REST 测试构造认证头。 */
export function secretHeaders(actor: string): Record<string, string> {
  return {
    authorization: `Bearer ${actor}-token`,
    'content-type': 'application/json'
  }
}

/** 创建 SecretRef。 */
export async function createSecret(
  app: SecretPolicyApp,
  actor: string,
  body: { name: string; scope: 'system' | 'service' | 'node'; value: string }
) {
  return app.handle(
    new Request('http://localhost/api/v0/secrets', {
      method: 'POST',
      headers: secretHeaders(actor),
      body: JSON.stringify(body)
    })
  )
}

/** 轮换 SecretRef。 */
export async function rotateSecret(
  app: SecretPolicyApp,
  actor: string,
  secretId: string,
  body: { value: string; reason: string }
) {
  return app.handle(
    new Request(`http://localhost/api/v0/secrets/${secretId}/rotate`, {
      method: 'POST',
      headers: secretHeaders(actor),
      body: JSON.stringify(body)
    })
  )
}

/** 禁用 SecretRef。 */
export async function disableSecret(
  app: SecretPolicyApp,
  actor: string,
  secretId: string,
  body: { reason: string }
) {
  return app.handle(
    new Request(`http://localhost/api/v0/secrets/${secretId}/disable`, {
      method: 'POST',
      headers: secretHeaders(actor),
      body: JSON.stringify(body)
    })
  )
}

/** 读取单个 SecretRef。 */
export async function showSecret(app: SecretPolicyApp, actor: string, secretId: string) {
  return app.handle(
    new Request(`http://localhost/api/v0/secrets/${secretId}`, {
      headers: { authorization: `Bearer ${actor}-token` }
    })
  )
}

/** 列出 SecretRef。 */
export async function listSecrets(app: SecretPolicyApp, actor: string) {
  return app.handle(
    new Request('http://localhost/api/v0/secrets', {
      headers: { authorization: `Bearer ${actor}-token` }
    })
  )
}
