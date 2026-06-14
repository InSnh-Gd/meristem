import { expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  createSecret,
  disableSecret,
  rotateSecret,
  showSecret,
  secretHeaders
} from '../helpers/secret-policy.ts'

export function registerSecretPolicyStateTests(): void {
  it('secret rotate on non-existent id returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await rotateSecret(app, 'security-admin', 'SEC-FM-POLICY-NONEXISTENT', {
      value: 'new-value',
      reason: 'rotate non-existent secret'
    })

    expect(response.status).toBe(404)
  })

  it('secret disable on non-existent id returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await disableSecret(app, 'security-admin', 'SEC-FM-POLICY-NONEXISTENT', {
      reason: 'disable non-existent secret'
    })

    expect(response.status).toBe(404)
  })

  it('secret show on non-existent id returns 404', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const response = await showSecret(app, 'security-admin', 'SEC-FM-POLICY-NONEXISTENT')

    expect(response.status).toBe(404)
  })

  it('disabled secret cannot be rotated (returns 409)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    // First create a secret.
    const createResponse = await createSecret(app, 'security-admin', {
      name: 'disable-then-rotate-test',
      scope: 'node',
      value: 'initial-value'
    })

    expect(createResponse.status).toBe(201)
    const createBody = (await createResponse.json()) as { id: string }
    const secretId = createBody.id

    // Then disable it.
    await disableSecret(app, 'security-admin', secretId, {
      reason: 'SEC-FM-POLICY prepare for rotate-on-disabled test'
    })

    // Now try to rotate the disabled secret.
    const rotateResponse = await rotateSecret(app, 'security-admin', secretId, {
      value: 'should-fail-on-disabled',
      reason: 'rotate disabled secret'
    })

    expect(rotateResponse.status).toBe(409)
  })

  it('disabled secret cannot be re-disabled (returns 409)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const createResponse = await createSecret(app, 'security-admin', {
      name: 'double-disable-test',
      scope: 'system',
      value: 'initial-value'
    })

    expect(createResponse.status).toBe(201)
    const createBody = (await createResponse.json()) as { id: string }
    const secretId = createBody.id

    // First disable.
    await disableSecret(app, 'security-admin', secretId, {
      reason: 'SEC-FM-POLICY first disable'
    })

    // Second disable on already-disabled secret.
    const secondDisable = await app.handle(
      new Request(`http://localhost/api/v0/secrets/${secretId}/disable`, {
        method: 'POST',
        headers: secretHeaders('security-admin'),
        body: JSON.stringify({
          reason: 'SEC-FM-POLICY second disable attempt'
        })
      })
    )

    expect(secondDisable.status).toBe(409)
  })
}
