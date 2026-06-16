import { expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  bearerHeaders,
  draftConfig,
  getConfig,
  publishConfig,
  rollbackConfig
} from '../helpers/config-lifecycle.ts'

export function registerConfigLifecycleDegradedOpsTests(): void {
  it('returns 503 when policy is unavailable for config publish', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    // Publish is high-risk and must fail closed when policy is unavailable.
    const response = await publishConfig(app, 'CFG-FM-POLICY-cfg-001', 'security-admin')

    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('policy.unavailable')
  })

  it('returns 503 when policy is unavailable for config rollback', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(app, 'CFG-FM-POLICY-cfg-002', '0.1.0', 'security-admin')

    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('policy.unavailable')
  })

  it('returns 503 when audit log is unavailable for config publish', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await publishConfig(app, 'CFG-FM-AUDIT-cfg-001', 'security-admin')

    // Publish is high-risk and requires an audit write.
    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('audit.unavailable')
  })

  it('returns 503 when audit log is unavailable for config rollback', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'security-admin',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await rollbackConfig(app, 'CFG-FM-AUDIT-cfg-002', '0.1.0', 'security-admin')

    expect(response.status).toBe(503)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('audit.unavailable')
  })

  it('allows config draft even when policy is unavailable (draft is not high-risk)', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'admin',
      policyAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await draftConfig(app, 'admin')

    // Draft creation is normal-risk and remains available during dependency degradation.
    expect(response.status).toBe(201)

    const body = (await response.json()) as { config: { id: string; status: string } }
    expect(body.config.status).toBe('draft')
  })

  it('allows config list even when audit is unavailable (read is not high-risk)', async () => {
    const deps = createInMemoryCoreDeps({
      actor: 'viewer',
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await app.handle(
      new Request('http://localhost/api/v0/configs', {
        headers: bearerHeaders('viewer')
      })
    )

    // Read paths stay available when audit is degraded.
    expect(response.status).toBe(200)
  })

  it('allows config show even when both policy and audit are unavailable', async () => {
    // Verify the config show route does not depend on policy or audit availability.
    // Read operations are normal-risk and should work with degraded dependencies.
    const deps = createInMemoryCoreDeps({
      actor: 'operator',
      policyAvailable: false,
      auditAvailable: false
    })
    const app = createCoreApp(deps)

    const response = await getConfig(app, 'CFG-FM-DEGRADED-read-001', 'operator')

    // Config does not exist in this in-memory app, but the route correctly
    // handles the request without requiring policy/audit — returning 404
    // (not found) proves the read path is independent of those dependencies.
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('config.not_found')
  })
}
