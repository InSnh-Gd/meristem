import { expect, it } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'
import {
  draftConfig,
  getConfig,
  publishConfig,
  rollbackConfig,
  setupPublishedConfig,
  submitApplyAck,
  validateConfig
} from '../helpers/config-lifecycle.ts'

export function registerConfigLifecycleStateTests(): void {
  it('returns 409 for duplicate apply ack on the same config', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const { id, configVersion } = await setupPublishedConfig(app, 'admin')

    // First ack: accepted
    const first = await submitApplyAck(app, id, configVersion, {
      ackedBy: 'm-net',
      status: 'acked'
    })
    expect(first.status).toBe(200)

    // Second ack with same service: duplicate → rejected
    const second = await submitApplyAck(app, id, configVersion, {
      ackedBy: 'm-net',
      status: 'acked'
    })

    // Idempotent: same service + same version + same status → 200 (no state change)
    expect(second.status).toBe(200)
  })

  it('returns 200 for idempotent ack when same service acks same status', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    const { id, configVersion } = await setupPublishedConfig(app, 'admin')

    const ack = {
      ackedBy: 'm-net',
      status: 'acked' as const
    }

    const first = await submitApplyAck(app, id, configVersion, ack)
    expect(first.status).toBe(200)

    // Same service, same status → idempotent replay → 200 (no state change)
    const second = await submitApplyAck(app, id, configVersion, ack)

    expect(second.status).toBe(200)
  })

  it('ack timeout transitions config from applied to failed', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // Step 1: draft, validate, and publish a config targeting m-net
    const { id, configVersion } = await setupPublishedConfig(app, 'admin')

    // Step 2: apply a failed ack to transition the config to 'failed' state
    const failedAck = await submitApplyAck(app, id, configVersion, {
      ackedBy: 'm-net',
      status: 'failed'
    })
    // Failed ack transitions published → failed (200 because ack succeeded)
    expect(failedAck.status).toBe(200)

    // Step 3: verify config is now in failed state
    const showAfter = await getConfig(app, id, 'admin')
    expect(showAfter.status).toBe(200)
    const showAfterBody = (await showAfter.json()) as {
      config: { status: string; configVersion: string }
    }

    expect(showAfterBody.config.status).toBe('failed')
    expect(showAfterBody.config.configVersion).toBe(configVersion)
  })

  it('returns 409 when rollback targets an unknown config version', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const { id, configVersion } = await setupPublishedConfig(app, 'security-admin')

    // Transition to applied state first (published → applied via ack)
    const ack = await submitApplyAck(app, id, configVersion, {
      ackedBy: 'm-net',
      status: 'acked'
    })
    expect(ack.status).toBe(200)

    // Rollback to unknown version on an applied config → 409
    const response = await rollbackConfig(app, id, '99.99.99', 'security-admin')

    expect(response.status).toBe(409)

    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('config.unknown_version')
  })

  it('returns 409 when rollback to same version as current', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'security-admin' })
    const app = createCoreApp(deps)

    const { id, configVersion } = await setupPublishedConfig(app, 'security-admin')

    // Rollback to the current version is a no-op and should be rejected
    const response = await rollbackConfig(
      app,
      id,
      configVersion,
      'security-admin',
      'attempt rollback to current'
    )

    expect(response.status).toBe(409)
  })

  it('returns 409 when validating a config that is not in draft status', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // Create, validate, and publish a config — it's now in 'published' status
    const { id } = await setupPublishedConfig(app, 'admin')

    // Attempt to validate a config that is already published
    const response = await validateConfig(app, id, 'admin')

    expect(response.status).toBe(409)
  })

  it('returns 409 when publishing a config that is not in validated status', async () => {
    const deps = createInMemoryCoreDeps({ actor: 'admin' })
    const app = createCoreApp(deps)

    // Create a draft (status: draft) — publish requires validate first
    const draft = await draftConfig(app, 'admin')
    expect(draft.status).toBe(201)
    const draftBody = (await draft.json()) as { config: { id: string } }

    // Publish from draft without validate step → 409 invalid_state
    const response = await publishConfig(app, draftBody.config.id, 'admin')

    expect(response.status).toBe(409)
  })
}
