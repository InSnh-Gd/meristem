import { expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  createSecret,
  disableSecret,
  listSecrets,
  rotateSecret,
  showSecret
} from '../helpers/secret-policy.ts'

export function registerSecretPolicyRbacTests(): void {
  it('operator cannot create secrets (lacks secret:create)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await createSecret(app, 'operator', {
      name: 'operator-create-attempt',
      scope: 'service',
      value: 'should-not-work'
    })

    expect(response.status).toBe(403)
  })

  it('operator cannot rotate secrets (lacks secret:rotate)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await rotateSecret(app, 'operator', 'SEC-FM-POLICY-003', {
      value: 'should-not-work',
      reason: 'operator rotation attempt'
    })

    expect(response.status).toBe(403)
  })

  it('operator cannot disable secrets (lacks secret:disable)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'operator' })
    const app = createCoreApp(deps)

    const response = await disableSecret(app, 'operator', 'SEC-FM-POLICY-003', {
      reason: 'operator disable attempt'
    })

    expect(response.status).toBe(403)
  })

  it('viewer cannot read secret metadata (lacks secret:read-metadata)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await showSecret(app, 'viewer', 'SEC-FM-POLICY-004')

    expect(response.status).toBe(403)
  })

  it('viewer cannot list secrets (lacks secret:read-metadata)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await listSecrets(app, 'viewer')

    expect(response.status).toBe(403)
  })

  it('viewer cannot create secrets (lacks secret:create)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await createSecret(app, 'viewer', {
      name: 'viewer-create-attempt',
      scope: 'service',
      value: 'should-not-work'
    })

    expect(response.status).toBe(403)
  })

  it('viewer cannot rotate secrets (lacks secret:rotate)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await rotateSecret(app, 'viewer', 'SEC-FM-POLICY-005', {
      value: 'should-not-work',
      reason: 'viewer rotation attempt'
    })

    expect(response.status).toBe(403)
  })

  it('viewer cannot disable secrets (lacks secret:disable)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'viewer' })
    const app = createCoreApp(deps)

    const response = await disableSecret(app, 'viewer', 'SEC-FM-POLICY-005', {
      reason: 'viewer disable attempt'
    })

    expect(response.status).toBe(403)
  })

  it('admin cannot create secrets (lacks secret:create)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await createSecret(app, 'admin', {
      name: 'admin-create-attempt',
      scope: 'service',
      value: 'should-not-work'
    })

    expect(response.status).toBe(403)
  })

  it('admin cannot rotate secrets (lacks secret:rotate)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await rotateSecret(app, 'admin', 'SEC-FM-POLICY-006', {
      value: 'should-not-work',
      reason: 'admin rotation attempt'
    })

    expect(response.status).toBe(403)
  })

  it('admin cannot disable secrets (lacks secret:disable)', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const response = await disableSecret(app, 'admin', 'SEC-FM-POLICY-006', {
      reason: 'admin disable attempt'
    })

    expect(response.status).toBe(403)
  })
}
