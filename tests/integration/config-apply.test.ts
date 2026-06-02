import { describe, expect, test } from 'bun:test'
import { createCoreApp } from '../../apps/core/src/app.ts'
import { createConfigStateMachine } from '../../apps/core/src/config-state-machine.ts'
import { createInMemoryCoreDeps } from '../../apps/core/src/testing.ts'

type ConfigDomain = 'm-net' | 'm-extension'
type AckStatus = 'acked' | 'failed'

type ConfigDetailBody = {
  config: {
    id: string
    configVersion: string
    configHash: string
    domain: string
    status: string
  }
}

type ConfigDraftBody = {
  config: {
    id: string
    configVersion: string
    status: 'draft'
  }
}

type ConfigPublishBody = {
  config: {
    id: string
    configVersion: string
    status: 'published'
  }
}

type ConfigAckBody = {
  ack: {
    ackId: string
    configId: string
    configVersion: string
    ackedBy: string
    status: AckStatus
    ackedAt: string
    errorCode?: string
    errorMessage?: string
  }
}

type ErrorBody = {
  error: {
    code: string
    message: string
  }
}

const adminHeaders = {
  authorization: 'Bearer admin-token',
  'content-type': 'application/json'
}

const internalHeaders = {
  'x-meristem-internal-token': 'test-internal-token',
  'content-type': 'application/json'
}

async function readJson<T>(response: Response): Promise<T> {
  return await response.json() as T
}

async function createPublishedConfig(input: {
  domain: ConfigDomain
  payload: Record<string, unknown>
  targetScope: string[]
}) {
  const deps = createInMemoryCoreDeps({ actor: 'admin' })
  const app = createCoreApp(deps)

  const draftResponse = await app.handle(new Request('http://localhost/api/v0/configs/drafts', {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify(input)
  }))
  expect(draftResponse.status).toBe(201)
  const draftBody = await readJson<ConfigDraftBody>(draftResponse)

  const validateResponse = await app.handle(new Request(`http://localhost/api/v0/configs/${draftBody.config.id}/validate`, {
    method: 'POST',
    headers: adminHeaders
  }))
  expect(validateResponse.status).toBe(200)

  const publishResponse = await app.handle(new Request(`http://localhost/api/v0/configs/${draftBody.config.id}/publish`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ reason: `${input.domain} metadata handoff integration` })
  }))
  expect(publishResponse.status).toBe(200)
  const publishBody = await readJson<ConfigPublishBody>(publishResponse)

  return { app, deps, configId: draftBody.config.id, configVersion: publishBody.config.configVersion }
}

async function getConfig(app: ReturnType<typeof createCoreApp>, configId: string): Promise<ConfigDetailBody['config']> {
  const response = await app.handle(new Request(`http://localhost/api/v0/configs/${configId}`, {
    headers: adminHeaders
  }))
  expect(response.status).toBe(200)
  return (await readJson<ConfigDetailBody>(response)).config
}

async function applyAck(app: ReturnType<typeof createCoreApp>, input: {
  configId: string
  configVersion: string
  targetService: string
  status: AckStatus
  errorCode?: string
  errorMessage?: string
}): Promise<{ status: number; body: ConfigAckBody }> {
  const response = await app.handle(new Request(`http://localhost/internal/v0/configs/${input.configId}/apply-ack`, {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify({
      configVersion: input.configVersion,
      targetService: input.targetService,
      status: input.status,
      ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      ...(input.errorMessage ? { errorMessage: input.errorMessage } : {})
    })
  }))

  return { status: response.status, body: await readJson<ConfigAckBody>(response) }
}

function expectAckRecord(ack: ConfigAckBody['ack'], input: {
  configId: string
  configVersion: string
  targetService: string
  status: AckStatus
}) {
  expect(ack.ackId).toBeString()
  expect(ack.configId).toBe(input.configId)
  expect(ack.configVersion).toBe(input.configVersion)
  expect(ack.ackedBy).toBe(input.targetService)
  expect(ack.status).toBe(input.status)
  expect(ack.ackedAt).toBeString()
}

describe('Config Apply Ack Integration', () => {
  test('M-Extension config schema metadata handoff ack persists', async () => {
    expect(createConfigStateMachine).toBeFunction()
    const { app, configId, configVersion } = await createPublishedConfig({
      domain: 'm-extension',
      payload: {
        metadataKind: 'extension-config-schema',
        schemaVersion: 'm-extension-config-schema@0.1.0',
        schemaHash: 'sha256-extension-schema-fixture'
      },
      targetScope: ['m-extension']
    })

    const ack = await applyAck(app, {
      configId,
      configVersion,
      targetService: 'm-extension',
      status: 'acked'
    })

    expect(ack.status).toBe(200)
    expectAckRecord(ack.body.ack, { configId, configVersion, targetService: 'm-extension', status: 'acked' })
    const persisted = await getConfig(app, configId)
    expect(persisted.domain).toBe('m-extension')
    expect(persisted.configVersion).toBe(configVersion)
    expect(persisted.status).toBe('applied')
  })

  test('M-Net profile metadata handoff ack persists', async () => {
    const { app, configId, configVersion } = await createPublishedConfig({
      domain: 'm-net',
      payload: {
        metadataKind: 'm-net-profile',
        profileVersion: 'm-net-cn@0.1.0',
        profileHash: 'sha256-mnet-profile-fixture'
      },
      targetScope: ['m-net']
    })

    const ack = await applyAck(app, {
      configId,
      configVersion,
      targetService: 'm-net',
      status: 'acked'
    })

    expect(ack.status).toBe(200)
    expectAckRecord(ack.body.ack, { configId, configVersion, targetService: 'm-net', status: 'acked' })
    const persisted = await getConfig(app, configId)
    expect(persisted.domain).toBe('m-net')
    expect(persisted.configHash).toBeString()
    expect(persisted.status).toBe('applied')
  })

  test('Duplicate ack is idempotent', async () => {
    const { app, configId, configVersion } = await createPublishedConfig({
      domain: 'm-net',
      payload: { metadataKind: 'm-net-profile', profileVersion: 'm-net-cn@0.1.0' },
      targetScope: ['m-net']
    })

    const first = await applyAck(app, { configId, configVersion, targetService: 'm-net', status: 'acked' })
    const second = await applyAck(app, { configId, configVersion, targetService: 'm-net', status: 'acked' })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.ack.ackId).toBe(first.body.ack.ackId)
    expectAckRecord(second.body.ack, { configId, configVersion, targetService: 'm-net', status: 'acked' })
  })

  test('Failure ack records error without corrupting published version', async () => {
    const { app, configId, configVersion } = await createPublishedConfig({
      domain: 'm-extension',
      payload: { metadataKind: 'extension-config-schema', schemaVersion: 'm-extension-config-schema@0.1.0' },
      targetScope: ['m-extension']
    })

    const ack = await applyAck(app, {
      configId,
      configVersion,
      targetService: 'm-extension',
      status: 'failed',
      errorCode: 'm-extension.apply.schema_rejected',
      errorMessage: 'extension schema metadata hash did not match registry manifest'
    })

    expect(ack.status).toBe(200)
    expectAckRecord(ack.body.ack, { configId, configVersion, targetService: 'm-extension', status: 'failed' })
    expect(ack.body.ack.errorCode).toBe('m-extension.apply.schema_rejected')
    expect(ack.body.ack.errorMessage).toBe('extension schema metadata hash did not match registry manifest')
    const persisted = await getConfig(app, configId)
    expect(persisted.configVersion).toBe(configVersion)
    expect(persisted.status).toBe('failed')
  })

  test('Timeout records apply failed', async () => {
    const { app, deps, configId, configVersion } = await createPublishedConfig({
      domain: 'm-net',
      payload: { metadataKind: 'm-net-profile', profileVersion: 'm-net-cn@0.1.0' },
      targetScope: ['m-net']
    })

    const timeout = await deps.config.applyAck(configId, {
      version: configVersion,
      targetService: 'm-net',
      status: 'pending',
      correlationId: 'config-apply-timeout-test'
    })

    expect(timeout.ok).toBe(false)
    if (!timeout.ok) expect(timeout.error.code).toBe('config.ack_timeout')

    const duplicateTimeout = await deps.config.applyAck(configId, {
      version: configVersion,
      targetService: 'm-net',
      status: 'pending',
      correlationId: 'config-apply-timeout-test-duplicate'
    })

    expect(duplicateTimeout.ok).toBe(true)
    if (duplicateTimeout.ok) {
      expect(duplicateTimeout.value.ackId).toBeString()
      expect(duplicateTimeout.value.status).toBe('failed')
      expect(duplicateTimeout.value.ackedAt).toBeString()
    }
    const persisted = await getConfig(app, configId)
    expect(persisted.configVersion).toBe(configVersion)
    expect(persisted.status).toBe('failed')
  })

  test('Rollback to unknown version is rejected', async () => {
    const { app, configId, configVersion } = await createPublishedConfig({
      domain: 'm-extension',
      payload: { metadataKind: 'extension-config-schema', schemaVersion: 'm-extension-config-schema@0.1.0' },
      targetScope: ['m-extension']
    })
    const ack = await applyAck(app, { configId, configVersion, targetService: 'm-extension', status: 'acked' })
    expect(ack.status).toBe(200)

    const rollbackResponse = await app.handle(new Request(`http://localhost/api/v0/configs/${configId}/rollback`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ toVersion: 'unknown-version-123', reason: 'reject unknown rollback target' })
    }))

    expect(rollbackResponse.status).toBe(409)
    const rollbackBody = await readJson<ErrorBody>(rollbackResponse)
    expect(rollbackBody.error.code).toBe('config.unknown_version')
  })
})
