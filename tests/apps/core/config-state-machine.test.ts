import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { BASE_TIME, FakeConfigStore, versionKey } from './config-state-machine-fake-store.ts'

type ResultLike<T, E> = { ok: true; value: T } | { ok: false; error: E }
type ConfigError = { code: string; message: string }

const STORE_MODULE = '../../../apps/core/src/storage-adapter.ts'

function unwrapOk<T, E>(result: ResultLike<T, E>): T {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`expected ok result, got ${JSON.stringify(result.error)}`)
  return result.value
}

function unwrapErr<T, E extends ConfigError>(result: ResultLike<T, E>): E {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error(`expected error result, got ${JSON.stringify(result.value)}`)
  return result.error
}

let activeStore = new FakeConfigStore()

mock.module(STORE_MODULE, () => ({
  createConfigStore: () => activeStore
}))

const { computeConfigHash, computeConfigVersion, createConfigStateMachine } = await import(
  '../../../apps/core/src/config-state-machine.ts'
)

function createPort() {
  // 这里替换了 store factory，数据库参数仅用于穿过生产状态机入口。
  return createConfigStateMachine({} as MeristemDb)
}

beforeEach(() => {
  activeStore = new FakeConfigStore()
})

describe('computeConfigHash', () => {
  it('returns a 64-character hex string', async () => {
    const hash = await computeConfigHash({ domain: 'm-net' })

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns the same hash for the same payload', async () => {
    const payload = { domain: 'm-net', enabled: true }

    await expect(computeConfigHash(payload)).resolves.toBe(await computeConfigHash(payload))
  })

  it('returns different hashes for different payloads', async () => {
    const left = await computeConfigHash({ domain: 'm-net', enabled: true })
    const right = await computeConfigHash({ domain: 'm-net', enabled: false })

    expect(left).not.toBe(right)
  })

  it('handles nested objects with stable key ordering', async () => {
    const left = await computeConfigHash({ nested: { beta: 2, alpha: 1 } })
    const right = await computeConfigHash({ nested: { alpha: 1, beta: 2 } })

    expect(left).toBe(right)
  })

  it('handles arrays', async () => {
    const left = await computeConfigHash({ targets: ['core', 'm-net'] })
    const right = await computeConfigHash({ targets: ['m-net', 'core'] })

    expect(left).not.toBe(right)
  })
})

describe('computeConfigVersion', () => {
  it('returns hash prefix and timestamp format', () => {
    expect(computeConfigVersion('abc12345def67890', 1234567890)).toBe('abc12345-1234567890')
  })

  it('returns consistent output for same inputs', () => {
    const hash = 'abcdef1234567890'
    const timestamp = 1234567890

    expect(computeConfigVersion(hash, timestamp)).toBe(computeConfigVersion(hash, timestamp))
  })
})

describe('createConfigStateMachine', () => {
  it('lists summaries and returns full records from the production port', async () => {
    const record = activeStore.seedConfig({
      id: 'config-list',
      payload: { secretRef: 'vault://db' }
    })
    const port = createPort()

    expect(unwrapOk(await port.list())).toEqual([
      {
        id: record.id,
        configVersion: record.configVersion,
        domain: record.domain,
        status: record.status,
        createdBy: record.createdBy,
        createdAt: record.createdAt
      }
    ])
    expect(unwrapOk(await port.get(record.id))).toEqual(record)
  })

  it('draft persists a config record and version through the store factory', async () => {
    const port = createPort()
    const targetScope = ['m-log', 'm-policy']
    const result = unwrapOk(
      await port.draft({
        domain: 'm-net',
        payload: { nested: { enabled: true } },
        targetScope,
        correlationId: 'actor-draft'
      })
    )
    targetScope.push('late-mutation')

    const record = activeStore.records.get(result.id)
    const version = activeStore.versions.get(versionKey(result.id, result.configVersion))
    expect(record).toMatchObject({
      id: result.id,
      configVersion: result.configVersion,
      schemaVersion: 'config@0.1.0',
      domain: 'm-net',
      targetScope: ['m-log', 'm-policy'],
      status: 'draft',
      payload: { nested: { enabled: true } },
      createdBy: 'actor-draft'
    })
    expect(record?.configHash).toMatch(/^[a-f0-9]{64}$/)
    expect(version).toMatchObject({
      configId: result.id,
      version: result.configVersion,
      configHash: record?.configHash,
      status: 'draft',
      createdBy: 'actor-draft'
    })
  })

  it('draft falls back to system actor when correlation id is empty', async () => {
    const port = createPort()
    const result = unwrapOk(
      await port.draft({ domain: 'm-net', payload: { enabled: true }, correlationId: '' })
    )

    expect(activeStore.records.get(result.id)?.createdBy).toBe('system')
  })

  it('draft rejects nested plaintext secrets without store writes', async () => {
    const port = createPort()
    const error = unwrapErr(
      await port.draft({
        domain: 'm-net',
        payload: { database: { apiToken: 'plain-token' } },
        correlationId: 'actor-secret'
      })
    )

    expect(error.code).toBe('config.secret_plaintext')
    expect(activeStore.records.size).toBe(0)
    expect(activeStore.versions.size).toBe(0)
  })

  it('draft accepts secretRef fields as non-secret plaintext payload', async () => {
    const port = createPort()
    const result = unwrapOk(
      await port.draft({
        domain: 'm-net',
        payload: {
          database: { passwordSecretRef: 'vault://database/password' },
          tokens: [{ apiTokenSecretRef: 'vault://service/token' }]
        },
        correlationId: 'actor-secret-ref'
      })
    )

    expect(activeStore.records.get(result.id)?.status).toBe('draft')
  })

  it('validate moves draft configs to validated and records a transition', async () => {
    const record = activeStore.seedConfig({ status: 'draft' })
    const port = createPort()

    expect(unwrapOk(await port.validate(record.id))).toEqual({ id: record.id, status: 'validated' })
    expect(activeStore.records.get(record.id)?.status).toBe('validated')
    expect(activeStore.transitions).toHaveLength(1)
    expect(activeStore.transitions[0]).toMatchObject({
      configId: record.id,
      fromStatus: 'draft',
      toStatus: 'validated',
      actor: record.createdBy
    })
  })

  it('validate reports missing records and invalid transitions', async () => {
    const port = createPort()
    expect(unwrapErr(await port.validate('missing')).code).toBe('config.not_found')

    activeStore.seedConfig({ status: 'published' })
    expect(unwrapErr(await port.validate('config-1')).code).toBe('config.invalid_state')
    expect(activeStore.transitions).toHaveLength(0)
  })

  it('publish moves validated configs to published with actor, reason, and timestamp', async () => {
    const record = activeStore.seedConfig({ status: 'validated' })
    const port = createPort()
    const result = unwrapOk(
      await port.publish(record.id, { reason: 'roll out config', correlationId: 'publisher-1' })
    )

    expect(result).toMatchObject({
      id: record.id,
      configVersion: record.configVersion,
      status: 'published',
      publishedBy: 'publisher-1'
    })
    expect(result.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(activeStore.records.get(record.id)).toMatchObject({
      status: 'published',
      publishedBy: 'publisher-1',
      publishedAt: result.publishedAt
    })
    expect(activeStore.transitions[0]).toMatchObject({
      fromStatus: 'validated',
      toStatus: 'published',
      actor: 'publisher-1',
      reason: 'roll out config',
      correlationId: 'publisher-1'
    })
  })

  it('publish rejects draft configs before writing transition state', async () => {
    const record = activeStore.seedConfig({ status: 'draft' })
    const port = createPort()

    expect(
      unwrapErr(
        await port.publish(record.id, { reason: 'too early', correlationId: 'publisher-1' })
      ).code
    ).toBe('config.invalid_state')
    expect(activeStore.records.get(record.id)?.status).toBe('draft')
    expect(activeStore.transitions).toHaveLength(0)
  })

  it('applyAck records partial acks without applying the config', async () => {
    const record = activeStore.seedConfig({
      status: 'published',
      targetScope: ['m-log', 'm-policy']
    })
    const port = createPort()
    const result = unwrapOk(
      await port.applyAck(record.id, {
        version: record.configVersion,
        targetService: 'm-log',
        status: 'acked',
        correlationId: 'ack-1'
      })
    )

    expect(result.status).toBe('acked')
    expect(activeStore.acks).toHaveLength(1)
    expect(activeStore.records.get(record.id)?.status).toBe('published')
    expect(activeStore.transitions).toHaveLength(0)
  })

  it('applyAck moves to applied once all target services ack', async () => {
    const record = activeStore.seedConfig({
      status: 'published',
      targetScope: ['m-log', 'm-policy']
    })
    activeStore.seedAck({ targetService: 'm-log' })
    const port = createPort()

    unwrapOk(
      await port.applyAck(record.id, {
        version: record.configVersion,
        targetService: 'm-policy',
        status: 'acked',
        correlationId: 'ack-2'
      })
    )

    expect(activeStore.records.get(record.id)?.status).toBe('applied')
    expect(activeStore.transitions[0]).toMatchObject({
      fromStatus: 'published',
      toStatus: 'applied',
      actor: 'm-policy',
      correlationId: 'ack-2'
    })
  })

  it('applyAck applies configs without explicit target scope on the first ack', async () => {
    const record = activeStore.seedConfig({ status: 'published', targetScope: [] })
    const port = createPort()

    unwrapOk(
      await port.applyAck(record.id, {
        version: record.configVersion,
        targetService: 'm-log',
        status: 'acked',
        correlationId: 'ack-empty-scope'
      })
    )

    expect(activeStore.records.get(record.id)?.status).toBe('applied')
  })

  it('applyAck reuses existing ack records idempotently', async () => {
    const record = activeStore.seedConfig({ status: 'published' })
    activeStore.seedAck({ id: 'ack-existing', targetService: 'm-log' })
    const port = createPort()

    expect(
      unwrapOk(
        await port.applyAck(record.id, {
          version: record.configVersion,
          targetService: 'm-log',
          status: 'acked',
          correlationId: 'ack-repeat'
        })
      )
    ).toEqual({ ackId: 'ack-existing', status: 'acked', ackedAt: BASE_TIME })
    expect(activeStore.acks).toHaveLength(1)
    expect(activeStore.transitions).toHaveLength(0)
  })

  it('applyAck failed records a failure ack and failed transition', async () => {
    const record = activeStore.seedConfig({ status: 'published' })
    const port = createPort()
    const result = unwrapOk(
      await port.applyAck(record.id, {
        version: record.configVersion,
        targetService: 'm-log',
        status: 'failed',
        error: 'reload failed',
        correlationId: 'ack-failed'
      })
    )

    expect(result.status).toBe('failed')
    expect(activeStore.acks[0]).toMatchObject({ status: 'failed', error: 'reload failed' })
    expect(activeStore.records.get(record.id)?.status).toBe('failed')
    expect(activeStore.transitions[0]).toMatchObject({
      toStatus: 'failed',
      actor: 'm-log',
      reason: 'reload failed',
      correlationId: 'ack-failed'
    })
  })

  it('applyAck pending records timeout failure and returns ack timeout error', async () => {
    const record = activeStore.seedConfig({ status: 'published' })
    const port = createPort()
    const error = unwrapErr(
      await port.applyAck(record.id, {
        version: record.configVersion,
        targetService: 'm-log',
        status: 'pending',
        correlationId: 'ack-pending'
      })
    )

    expect(error.code).toBe('config.ack_timeout')
    expect(activeStore.records.get(record.id)?.status).toBe('failed')
    expect(activeStore.acks[0]).toMatchObject({
      status: 'failed',
      error: 'apply ack timed out'
    })
    expect(activeStore.acks[0]?.expiresAt).toBeDefined()
  })

  it('applyAck rejects version mismatches and invalid ack statuses before writing', async () => {
    const record = activeStore.seedConfig({ status: 'published' })
    const port = createPort()

    expect(
      unwrapErr(
        await port.applyAck(record.id, {
          version: 'other-version',
          targetService: 'm-log',
          status: 'acked',
          correlationId: 'ack-version'
        })
      ).code
    ).toBe('config.version_mismatch')
    expect(
      unwrapErr(
        await port.applyAck(record.id, {
          version: record.configVersion,
          targetService: 'm-log',
          status: 'ignored',
          correlationId: 'ack-status'
        })
      ).code
    ).toBe('config.ack_invalid_status')
    expect(activeStore.acks).toHaveLength(0)
  })

  it('rollback moves applied configs to rolled_back when the target version exists', async () => {
    const record = activeStore.seedConfig({ status: 'applied' })
    activeStore.seedVersion({ version: 'version-rollback' })
    const port = createPort()

    expect(
      unwrapOk(
        await port.rollback(record.id, {
          toVersion: 'version-rollback',
          reason: 'bad rollout',
          correlationId: 'rollback-1'
        })
      )
    ).toEqual({ id: record.id, status: 'rolled_back' })
    expect(activeStore.records.get(record.id)).toMatchObject({
      status: 'rolled_back',
      rollbackVersion: 'version-rollback'
    })
    expect(activeStore.transitions[0]).toMatchObject({
      fromStatus: 'applied',
      toStatus: 'rolled_back',
      actor: 'rollback-1',
      reason: 'bad rollout',
      correlationId: 'rollback-1'
    })
  })

  it('rollback rejects missing target versions without state changes', async () => {
    const record = activeStore.seedConfig({ status: 'failed' })
    const port = createPort()
    const error = unwrapErr(
      await port.rollback(record.id, {
        toVersion: 'unknown-version',
        reason: 'bad rollout',
        correlationId: 'rollback-missing'
      })
    )

    expect(error.code).toBe('config.rollback_unknown_version')
    expect(activeStore.records.get(record.id)?.status).toBe('failed')
    expect(activeStore.transitions).toHaveLength(0)
  })
})
