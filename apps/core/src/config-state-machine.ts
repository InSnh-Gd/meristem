import { err, ok } from '../../../packages/common/src/result.ts'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { createConfigStore } from './storage-adapter.ts'
import type { ConfigPort, ServiceError } from './types.ts'

type ConfigStatus = 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
type AckStatus = 'pending' | 'acked' | 'failed'
type ConfigStore = ReturnType<typeof createConfigStore>
type ConfigRecord = NonNullable<Awaited<ReturnType<ConfigStore['get']>>>
type ApplyAckInput = Parameters<ConfigPort['applyAck']>[1]
type ApplyAckResponse = { ackId: string; status: 'acked' | 'failed'; ackedAt: string }

const CONFIG_SCHEMA_VERSION = 'config@0.1.0'
const APPLY_ACK_TIMEOUT_MS = 60_000

const VALID_TRANSITIONS: ReadonlyMap<ConfigStatus, ReadonlySet<ConfigStatus>> = new Map([
  ['draft', new Set(['validated'])],
  ['validated', new Set(['published', 'failed'])],
  ['published', new Set(['applied', 'failed'])],
  ['applied', new Set(['rolled_back'])],
  ['failed', new Set(['rolled_back'])],
  ['rolled_back', new Set()]
])

function configError(code: string, message: string): ServiceError {
  return { code, message }
}

function asConfigStatus(status: string): ConfigStatus | null {
  return status === 'draft' ||
    status === 'validated' ||
    status === 'published' ||
    status === 'applied' ||
    status === 'failed' ||
    status === 'rolled_back'
    ? status
    : null
}

function asAckStatus(status: string): AckStatus | null {
  return status === 'pending' || status === 'acked' || status === 'failed' ? status : null
}

function canTransition(fromStatus: string, toStatus: ConfigStatus): boolean {
  const from = asConfigStatus(fromStatus)
  return from ? (VALID_TRANSITIONS.get(from)?.has(toStatus) ?? false) : false
}

function ensureTransition(fromStatus: string, toStatus: ConfigStatus) {
  return canTransition(fromStatus, toStatus)
    ? null
    : configError(
        'config.invalid_state',
        `config cannot transition from ${fromStatus} to ${toStatus}`
      )
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

function containsPlaintextSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsPlaintextSecret)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'secretref' || normalizedKey.endsWith('secretref')) return false
    if (
      /(password|secret|token|privatekey|apikey)/u.test(normalizedKey) &&
      typeof entry === 'string' &&
      entry.length > 0
    ) {
      return true
    }
    return containsPlaintextSecret(entry)
  })
}

function actorFromCorrelation(correlationId: string): string {
  return correlationId || 'system'
}

async function updateWithTransition(
  store: ConfigStore,
  input: {
    id: string
    fromStatus: string
    toStatus: ConfigStatus
    actor: string
    reason?: string
    correlationId?: string
    extra?: Parameters<ReturnType<typeof createConfigStore>['updateStatus']>[2]
  }
): Promise<void> {
  await store.updateStatus(input.id, input.toStatus, input.extra)
  await store.recordTransition({
    id: crypto.randomUUID(),
    configId: input.id,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actor: input.actor,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    createdAt: new Date()
  })
}

async function requireRecordForTransition(
  store: ConfigStore,
  id: string,
  toStatus: ConfigStatus
): Promise<ConfigRecord | ServiceError> {
  const record = await store.get(id)
  if (!record) return configError('config.not_found', 'config record not found')
  const transitionError = ensureTransition(record.status, toStatus)
  return transitionError ?? record
}

async function handlePendingApplyAck(
  store: ConfigStore,
  input: { id: string; record: ConfigRecord; ack: ApplyAckInput; now: Date }
): Promise<ServiceError> {
  if (!canTransition(input.record.status, 'failed')) {
    return configError(
      'config.invalid_state',
      `config cannot transition from ${input.record.status} to failed`
    )
  }
  await updateWithTransition(store, {
    id: input.id,
    fromStatus: input.record.status,
    toStatus: 'failed',
    actor: input.ack.targetService,
    reason: 'apply ack timeout',
    correlationId: input.ack.correlationId
  })
  await store.recordAck({
    id: crypto.randomUUID(),
    configId: input.id,
    version: input.ack.version,
    targetService: input.ack.targetService,
    status: 'failed',
    error: input.ack.error ?? 'apply ack timed out',
    ackedAt: input.now,
    expiresAt: new Date(input.now.getTime() + APPLY_ACK_TIMEOUT_MS),
    createdAt: input.now
  })
  return configError('config.ack_timeout', 'config apply ack timed out while pending')
}

async function handleFailedApplyAck(
  store: ConfigStore,
  input: { id: string; record: ConfigRecord; ack: ApplyAckInput; now: Date }
): Promise<ApplyAckResponse | ServiceError> {
  const transitionError = ensureTransition(input.record.status, 'failed')
  if (transitionError) return transitionError

  const ackId = crypto.randomUUID()
  await store.recordAck({
    id: ackId,
    configId: input.id,
    version: input.ack.version,
    targetService: input.ack.targetService,
    status: 'failed',
    ...(input.ack.error ? { error: input.ack.error } : {}),
    ackedAt: input.now,
    createdAt: input.now
  })
  await updateWithTransition(store, {
    id: input.id,
    fromStatus: input.record.status,
    toStatus: 'failed',
    actor: input.ack.targetService,
    ...(input.ack.error ? { reason: input.ack.error } : {}),
    correlationId: input.ack.correlationId
  })
  return { ackId, status: 'failed', ackedAt: input.now.toISOString() }
}

async function handleAckedApplyAck(
  store: ConfigStore,
  input: { id: string; record: ConfigRecord; ack: ApplyAckInput; now: Date }
): Promise<ApplyAckResponse | ServiceError> {
  const ackId = crypto.randomUUID()
  await store.recordAck({
    id: ackId,
    configId: input.id,
    version: input.ack.version,
    targetService: input.ack.targetService,
    status: 'acked',
    ackedAt: input.now,
    createdAt: input.now
  })

  const targetScope: string[] = Array.isArray(input.record.targetScope) ? input.record.targetScope : []
  if (targetScope.length === 0) {
    const transitionError = ensureTransition(input.record.status, 'applied')
    if (transitionError) return transitionError
    await updateWithTransition(store, {
      id: input.id,
      fromStatus: input.record.status,
      toStatus: 'applied',
      actor: input.ack.targetService,
      correlationId: input.ack.correlationId
    })
    return { ackId, status: 'acked', ackedAt: input.now.toISOString() }
  }

  const allAcks = await store.listAcks(input.id, input.ack.version)
  const ackedServices = new Set(allAcks.map(ack => ack.targetService))
  const allAcked = targetScope.every(service => ackedServices.has(service))

  if (!allAcked) {
    return { ackId, status: 'acked', ackedAt: input.now.toISOString() }
  }

  const transitionError = ensureTransition(input.record.status, 'applied')
  if (transitionError) return transitionError
  await updateWithTransition(store, {
    id: input.id,
    fromStatus: input.record.status,
    toStatus: 'applied',
    actor: input.ack.targetService,
    correlationId: input.ack.correlationId
  })
  return { ackId, status: 'acked', ackedAt: input.now.toISOString() }
}

/**
 * createConfigStateMachine 将 ConfigPort 的生命周期规则绑定到 PostgreSQL 权威写模型。
 */
export function createConfigStateMachine(db: MeristemDb): ConfigPort {
  const store = createConfigStore(db)

  return {
    async list() {
      const records = await store.list()
      return ok(
        records.map(({ id, configVersion, domain, status, createdBy, createdAt }) => ({
          id,
          configVersion,
          domain,
          status,
          createdBy,
          createdAt
        }))
      )
    },

    async get(id) {
      return ok(await store.get(id))
    },

    async draft(input) {
      if (containsPlaintextSecret(input.payload)) {
        return err(
          configError(
            'config.secret_plaintext',
            'config payload must use secretRef instead of plaintext secrets'
          )
        )
      }

      const createdAt = new Date()
      const configHash = await computeConfigHash(input.payload)
      const configVersion = computeConfigVersion(configHash, createdAt.getTime())
      const id = crypto.randomUUID()
      const createdBy = actorFromCorrelation(input.correlationId)

      await store.create({
        id,
        configVersion,
        schemaVersion: CONFIG_SCHEMA_VERSION,
        configHash,
        domain: input.domain,
        targetScope: [...(input.targetScope ?? [])],
        status: 'draft',
        payload: input.payload,
        createdBy,
        createdAt
      })
      await store.createVersion({
        id: crypto.randomUUID(),
        configId: id,
        version: configVersion,
        configHash,
        payload: input.payload,
        status: 'draft',
        createdBy,
        createdAt
      })

      return ok({ id, configVersion, status: 'draft', createdAt: createdAt.toISOString() })
    },

    async validate(id) {
      const record = await requireRecordForTransition(store, id, 'validated')
      if ('code' in record) return err(record)

      await updateWithTransition(store, {
        id,
        fromStatus: record.status,
        toStatus: 'validated',
        actor: record.createdBy
      })
      return ok({ id, status: 'validated' })
    },

    async publish(id, input) {
      const record = await requireRecordForTransition(store, id, 'published')
      if ('code' in record) return err(record)

      const publishedAt = new Date()
      const publishedBy = actorFromCorrelation(input.correlationId)
      await updateWithTransition(store, {
        id,
        fromStatus: record.status,
        toStatus: 'published',
        actor: publishedBy,
        reason: input.reason,
        correlationId: input.correlationId,
        extra: { publishedBy, publishedAt }
      })
      return ok({
        id,
        configVersion: record.configVersion,
        status: 'published',
        publishedAt: publishedAt.toISOString(),
        publishedBy
      })
    },

    async rollback(id, input) {
      const record = await requireRecordForTransition(store, id, 'rolled_back')
      if ('code' in record) return err(record)

      const version = await store.getVersion(id, input.toVersion)
      if (!version)
        return err(
          configError('config.rollback_unknown_version', 'rollback target version is unknown')
        )

      await updateWithTransition(store, {
        id,
        fromStatus: record.status,
        toStatus: 'rolled_back',
        actor: actorFromCorrelation(input.correlationId),
        reason: input.reason,
        correlationId: input.correlationId,
        extra: { rollbackVersion: input.toVersion }
      })
      return ok({ id, status: 'rolled_back' })
    },

    async applyAck(id, input) {
      const record = await store.get(id)
      if (!record) return err(configError('config.not_found', 'config record not found'))
      if (record.configVersion !== input.version) {
        return err(
          configError(
            'config.version_mismatch',
            'apply ack version must match published config version'
          )
        )
      }

      const ackStatus = asAckStatus(input.status)
      if (!ackStatus)
        return err(configError('config.ack_invalid_status', 'apply ack status is invalid'))

      const existing = await store.getAck(id, input.targetService, input.version)
      if (existing) {
        return ok({
          ackId: existing.id,
          status: existing.status,
          ackedAt: existing.ackedAt ?? existing.createdAt
        })
      }

      const now = new Date()
      if (ackStatus === 'pending') {
        return err(await handlePendingApplyAck(store, { id, record, ack: input, now }))
      }

      // 单个 ack failed 直接导致配置转入 failed 状态
      if (ackStatus === 'failed') {
        const failed = await handleFailedApplyAck(store, { id, record, ack: input, now })
        return 'code' in failed ? err(failed) : ok(failed)
      }

      // ackStatus === 'acked': 记录 ack，然后检查是否所有 targetScope 服务都已 ack
      const acked = await handleAckedApplyAck(store, { id, record, ack: input, now })
      return 'code' in acked ? err(acked) : ok(acked)
    }
  }
}

/**
 * computeConfigHash 用递归排序后的 JSON 计算 SHA-256，确保同义 payload 得到同一 hash。
 */
export async function computeConfigHash(payload: unknown): Promise<string> {
  const canonical = JSON.stringify(canonicalize(payload))
  const bytes = new TextEncoder().encode(canonical)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * computeConfigVersion 将 hash 前缀和创建时间戳组合成稳定可追溯的版本号。
 */
export function computeConfigVersion(hash: string, timestamp: number): string {
  return `${hash.slice(0, 8)}-${timestamp}`
}
