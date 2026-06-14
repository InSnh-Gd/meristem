import { err, ok } from '../../../../packages/common/src/result.ts'
import { computeConfigHash, computeConfigVersion } from '../config-state-machine.ts'
import type { ConfigPort } from '../types.ts'
import {
  type ConfigAckRecord,
  configTransitionAllowed,
  hasPlaintextSecretPayload,
  type InMemoryCoreTestingHelpers,
  type InMemoryCoreTestingState
} from './shared.ts'

/**
 * createConfigPort 保持配置生命周期状态机不变，只把实现拆到独立模块便于维护。
 */
export function createConfigPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): ConfigPort {
  return {
    async list() {
      return ok(
        state.configRecords.map(({ id, configVersion, domain, status, createdBy, createdAt }) => ({
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
      const record = state.configRecords.find(candidate => candidate.id === id)
      return ok(
        record
          ? {
              id: record.id,
              configVersion: record.configVersion,
              schemaVersion: record.schemaVersion,
              configHash: record.configHash,
              domain: record.domain,
              targetScope: [...record.targetScope],
              status: record.status,
              payload: record.payload,
              createdBy: record.createdBy,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
              ...(record.publishedBy ? { publishedBy: record.publishedBy } : {}),
              ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
              ...(record.rollbackVersion ? { rollbackVersion: record.rollbackVersion } : {})
            }
          : null
      )
    },
    async draft(input) {
      if (hasPlaintextSecretPayload(input.payload)) {
        return err({
          code: 'config.secret_plaintext',
          message: 'config payload must use secretRef instead of plaintext secrets'
        })
      }

      const createdAt = new Date().toISOString()
      const id = crypto.randomUUID()
      const configHash = await computeConfigHash(input.payload)
      const configVersion = computeConfigVersion(configHash, Date.parse(createdAt))
      state.configRecords.push({
        id,
        configVersion,
        schemaVersion: 'config@0.1.0',
        configHash,
        domain: input.domain,
        targetScope: [...(input.targetScope ?? [])],
        status: 'draft',
        payload: input.payload,
        createdBy: helpers.actor,
        createdAt,
        updatedAt: createdAt
      })
      state.configVersions.push({
        id: crypto.randomUUID(),
        configId: id,
        version: configVersion,
        configHash,
        payload: input.payload,
        status: 'draft',
        createdBy: helpers.actor,
        createdAt
      })
      return ok({ id, configVersion, status: 'draft', createdAt })
    },
    async validate(id) {
      const record = state.configRecords.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'config.not_found', message: 'config record not found' })
      }
      if (!configTransitionAllowed(record.status, 'validated')) {
        return err({
          code: 'config.invalid_state',
          message: `config cannot transition from ${record.status} to validated`
        })
      }
      record.status = 'validated'
      record.updatedAt = new Date().toISOString()
      return ok({ id: record.id, status: record.status })
    },
    async publish(id, _input) {
      if (helpers.configOpsRequirePolicy()) {
        const policyUnavailable = helpers.ensurePolicyAvailable(
          'policy.unavailable',
          'M-Policy unavailable'
        )
        if (policyUnavailable) return err(policyUnavailable.error)
      }

      const record = state.configRecords.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'config.not_found', message: 'config record not found' })
      }
      if (!configTransitionAllowed(record.status, 'published')) {
        return err({
          code: 'config.invalid_state',
          message: `config cannot transition from ${record.status} to published`
        })
      }

      const publishedAt = new Date().toISOString()
      record.status = 'published'
      record.publishedAt = publishedAt
      record.publishedBy = helpers.actor
      record.updatedAt = publishedAt
      return ok({
        id: record.id,
        configVersion: record.configVersion,
        status: record.status,
        publishedAt,
        publishedBy: helpers.actor
      })
    },
    async rollback(id, input) {
      if (helpers.configOpsRequirePolicy()) {
        const policyUnavailable = helpers.ensurePolicyAvailable(
          'policy.unavailable',
          'M-Policy unavailable'
        )
        if (policyUnavailable) return err(policyUnavailable.error)
      }

      const record = state.configRecords.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'config.not_found', message: 'config record not found' })
      }
      if (!configTransitionAllowed(record.status, 'rolled_back')) {
        return err({
          code: 'config.invalid_state',
          message: `config cannot transition from ${record.status} to rolled_back`
        })
      }

      const targetVersion = state.configVersions.find(
        candidate => candidate.configId === id && candidate.version === input.toVersion
      )
      if (!targetVersion) {
        return err({
          code: 'config.rollback_unknown_version',
          message: 'rollback target version is unknown'
        })
      }

      record.status = 'rolled_back'
      record.rollbackVersion = input.toVersion
      record.updatedAt = new Date().toISOString()
      return ok({ id: record.id, status: record.status })
    },
    async applyAck(id, input) {
      const record = state.configRecords.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'config.not_found', message: 'config record not found' })
      }

      const existing = state.configAcks.find(
        candidate =>
          candidate.configId === id &&
          candidate.targetService === input.targetService &&
          candidate.version === input.version
      )
      if (existing) {
        return ok({ ackId: existing.ackId, status: existing.status, ackedAt: existing.ackedAt })
      }

      if (record.configVersion !== input.version) {
        return err({
          code: 'config.version_mismatch',
          message: 'apply ack version must match published config version'
        })
      }

      if (input.status === 'pending') {
        if (configTransitionAllowed(record.status, 'failed')) {
          record.status = 'failed'
          record.updatedAt = new Date().toISOString()
          state.configAcks.push({
            ackId: crypto.randomUUID(),
            configId: id,
            version: input.version,
            targetService: input.targetService,
            status: 'failed',
            error: input.error ?? 'apply ack timed out',
            correlationId: input.correlationId,
            ackedAt: record.updatedAt,
            expiresAt: new Date(Date.now() + 60_000).toISOString()
          })
        }
        return err({
          code: 'config.ack_timeout',
          message: 'config apply ack timed out while pending'
        })
      }

      const nextStatus = input.status === 'failed' ? 'failed' : 'applied'
      if (nextStatus !== 'failed' && nextStatus !== 'applied') {
        return err({ code: 'config.ack_invalid_status', message: 'apply ack status is invalid' })
      }
      if (!configTransitionAllowed(record.status, nextStatus)) {
        return err({
          code: 'config.invalid_state',
          message: `config cannot transition from ${record.status} to ${nextStatus}`
        })
      }

      const ackedAt = new Date().toISOString()
      const ack: ConfigAckRecord = {
        ackId: crypto.randomUUID(),
        configId: id,
        version: input.version,
        targetService: input.targetService,
        status: input.status,
        ...(input.error ? { error: input.error } : {}),
        correlationId: input.correlationId,
        ackedAt
      }
      state.configAcks.push(ack)
      record.status = nextStatus
      record.updatedAt = ackedAt
      return ok({ ackId: ack.ackId, status: ack.status, ackedAt })
    }
  }
}
