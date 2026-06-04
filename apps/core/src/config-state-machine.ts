import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { err, ok } from '../../../packages/common/src/result.ts'
import { createConfigStore } from './storage-adapter.ts'
import type { ConfigPort, ServiceError } from './types.ts'

type ConfigStatus = 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
type AckStatus = 'pending' | 'acked' | 'failed'

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
  return status === 'draft'
    || status === 'validated'
    || status === 'published'
    || status === 'applied'
    || status === 'failed'
    || status === 'rolled_back'
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
    : configError('config.invalid_state', `config cannot transition from ${fromStatus} to ${toStatus}`)
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
    if (/(password|secret|token|privatekey|apikey)/u.test(normalizedKey) && typeof entry === 'string' && entry.length > 0) {
      return true
    }
    return containsPlaintextSecret(entry)
  })
}

function actorFromCorrelation(correlationId: string): string {
  return correlationId || 'system'
}

async function updateWithTransition(
  store: ReturnType<typeof createConfigStore>,
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

/**
 * createConfigStateMachine 将 ConfigPort 的生命周期规则绑定到 PostgreSQL 权威写模型。
 */
export function createConfigStateMachine(db: MeristemDb): ConfigPort {
  const store = createConfigStore(db)

  return {
    async list() {
      const records = await store.list()
      return ok(records.map(({ id, configVersion, domain, status, createdBy, createdAt }) => ({
        id,
        configVersion,
        domain,
        status,
        createdBy,
        createdAt
      })))
    },

    async get(id) {
      return ok(await store.get(id))
    },

    async draft(input) {
      if (containsPlaintextSecret(input.payload)) {
        return err(configError('config.secret_plaintext', 'config payload must use secretRef instead of plaintext secrets'))
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
      const record = await store.get(id)
      if (!record) return err(configError('config.not_found', 'config record not found'))
      const transitionError = ensureTransition(record.status, 'validated')
      if (transitionError) return err(transitionError)

      await updateWithTransition(store, {
        id,
        fromStatus: record.status,
        toStatus: 'validated',
        actor: record.createdBy
      })
      return ok({ id, status: 'validated' })
    },

    async publish(id, input) {
      const record = await store.get(id)
      if (!record) return err(configError('config.not_found', 'config record not found'))
      const transitionError = ensureTransition(record.status, 'published')
      if (transitionError) return err(transitionError)

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
      return ok({ id, configVersion: record.configVersion, status: 'published', publishedAt: publishedAt.toISOString(), publishedBy })
    },

    async rollback(id, input) {
      const record = await store.get(id)
      if (!record) return err(configError('config.not_found', 'config record not found'))
      const transitionError = ensureTransition(record.status, 'rolled_back')
      if (transitionError) return err(transitionError)

      const version = await store.getVersion(id, input.toVersion)
      if (!version) return err(configError('config.rollback_unknown_version', 'rollback target version is unknown'))

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
        return err(configError('config.version_mismatch', 'apply ack version must match published config version'))
      }

      const ackStatus = asAckStatus(input.status)
      if (!ackStatus) return err(configError('config.ack_invalid_status', 'apply ack status is invalid'))

      const existing = await store.getAck(id, input.targetService, input.version)
      if (existing) {
        return ok({ ackId: existing.id, status: existing.status, ackedAt: existing.ackedAt ?? existing.createdAt })
      }

      const now = new Date()
      if (ackStatus === 'pending') {
        if (!canTransition(record.status, 'failed')) {
          return err(configError('config.invalid_state', `config cannot transition from ${record.status} to failed`))
        }
        await updateWithTransition(store, {
          id,
          fromStatus: record.status,
          toStatus: 'failed',
          actor: input.targetService,
          reason: 'apply ack timeout',
          correlationId: input.correlationId
        })
        await store.recordAck({
          id: crypto.randomUUID(),
          configId: id,
          version: input.version,
          targetService: input.targetService,
          status: 'failed',
          error: input.error ?? 'apply ack timed out',
          ackedAt: now,
          expiresAt: new Date(now.getTime() + APPLY_ACK_TIMEOUT_MS),
          createdAt: now
        })
        return err(configError('config.ack_timeout', 'config apply ack timed out while pending'))
      }

      // 单个 ack failed 直接导致配置转入 failed 状态
      if (ackStatus === 'failed') {
        const transitionError = ensureTransition(record.status, 'failed')
        if (transitionError) return err(transitionError)

        const ackId = crypto.randomUUID()
        await store.recordAck({
          id: ackId,
          configId: id,
          version: input.version,
          targetService: input.targetService,
          status: 'failed',
          ...(input.error ? { error: input.error } : {}),
          ackedAt: now,
          createdAt: now
        })
        await updateWithTransition(store, {
          id,
          fromStatus: record.status,
          toStatus: 'failed',
          actor: input.targetService,
          ...(input.error ? { reason: input.error } : {}),
          correlationId: input.correlationId
        })
        return ok({ ackId, status: 'failed', ackedAt: now.toISOString() })
      }

      // ackStatus === 'acked': 记录 ack，然后检查是否所有 targetScope 服务都已 ack
      const ackId = crypto.randomUUID()
      await store.recordAck({
        id: ackId,
        configId: id,
        version: input.version,
        targetService: input.targetService,
        status: 'acked',
        ackedAt: now,
        createdAt: now
      })

      // 检查累计 ack 是否覆盖全部目标服务
      const targetScope: string[] = Array.isArray(record.targetScope) ? record.targetScope : []
      if (targetScope.length === 0) {
        // 无目标服务声明时，单个 ack 即可完成
        const transitionError = ensureTransition(record.status, 'applied')
        if (transitionError) return err(transitionError)
        await updateWithTransition(store, {
          id,
          fromStatus: record.status,
          toStatus: 'applied',
          actor: input.targetService,
          correlationId: input.correlationId
        })
        return ok({ ackId, status: 'acked', ackedAt: now.toISOString() })
      }

      const allAcks = await store.listAcks(id, input.version)
      const ackedServices = new Set(allAcks.map((ack) => ack.targetService))
      const allAcked = targetScope.every((service) => ackedServices.has(service))

      if (!allAcked) {
        // 尚有目标服务未 ack，保持当前状态不变
        return ok({ ackId, status: 'acked', ackedAt: now.toISOString() })
      }

      // 全部目标服务已 ack，转换到 applied
      const transitionError = ensureTransition(record.status, 'applied')
      if (transitionError) return err(transitionError)
      await updateWithTransition(store, {
        id,
        fromStatus: record.status,
        toStatus: 'applied',
        actor: input.targetService,
        correlationId: input.correlationId
      })
      return ok({ ackId, status: 'acked', ackedAt: now.toISOString() })
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
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * computeConfigVersion 将 hash 前缀和创建时间戳组合成稳定可追溯的版本号。
 */
export function computeConfigVersion(hash: string, timestamp: number): string {
  return `${hash.slice(0, 8)}-${timestamp}`
}
