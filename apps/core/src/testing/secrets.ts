import { err, ok } from '../../../../packages/common/src/result.ts'
import type { SecretRefPort } from '../types.ts'
import {
  type InMemoryCoreTestingHelpers,
  type InMemoryCoreTestingState,
  latestSecretVersion
} from './shared.ts'

/**
 * createSecretsPort 只对外暴露 secret ref 元数据和版本引用，避免明文泄漏到测试断言之外。
 */
export function createSecretsPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): SecretRefPort {
  return {
    async list() {
      return ok(
        state.secretRefs.map(({ id, name, scope, status, createdBy, createdAt, metadata }) => ({
          id,
          name,
          scope,
          status,
          createdBy,
          createdAt,
          metadata: { ...metadata }
        }))
      )
    },
    async get(id) {
      const record = state.secretRefs.find(candidate => candidate.id === id)
      return ok(
        record
          ? {
              id: record.id,
              name: record.name,
              scope: record.scope,
              status: record.status,
              createdBy: record.createdBy,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
              metadata: { ...record.metadata }
            }
          : null
      )
    },
    async create(input) {
      const policyUnavailable = helpers.ensurePolicyAvailable(
        'policy.unavailable',
        'M-Policy unavailable'
      )
      if (policyUnavailable) return err(policyUnavailable.error)
      const auditUnavailable = helpers.ensureAuditAvailable(
        'audit.unavailable',
        'Audit Log unavailable'
      )
      if (auditUnavailable) return err(auditUnavailable.error)

      const createdAt = new Date().toISOString()
      const id = crypto.randomUUID()
      const version = 'v1'
      state.secretRefs.push({
        id,
        name: input.name,
        scope: input.scope,
        status: 'active',
        createdBy: helpers.actor,
        createdAt,
        updatedAt: createdAt,
        metadata: { ...(input.metadata ?? {}) }
      })
      state.secretVersions.push({
        id: crypto.randomUUID(),
        secretRefId: id,
        version,
        value: input.value,
        createdBy: helpers.actor,
        createdAt
      })
      return ok({ id, name: input.name, status: 'active', createdAt })
    },
    async rotate(id, input) {
      const policyUnavailable = helpers.ensurePolicyAvailable(
        'policy.unavailable',
        'M-Policy unavailable'
      )
      if (policyUnavailable) return err(policyUnavailable.error)
      const auditUnavailable = helpers.ensureAuditAvailable(
        'audit.unavailable',
        'Audit Log unavailable'
      )
      if (auditUnavailable) return err(auditUnavailable.error)

      const record = state.secretRefs.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'secret.not_found', message: 'secret ref not found' })
      }

      const rotatedAt = new Date().toISOString()
      const version = `v${state.secretVersions.filter(candidate => candidate.secretRefId === id).length + 1}`
      record.status = 'rotated'
      record.updatedAt = rotatedAt
      state.secretVersions.push({
        id: crypto.randomUUID(),
        secretRefId: id,
        version,
        value: input.value,
        createdBy: helpers.actor,
        createdAt: rotatedAt
      })
      return ok({ id, version, status: record.status, rotatedAt })
    },
    async disable(id, _input) {
      const policyUnavailable = helpers.ensurePolicyAvailable(
        'policy.unavailable',
        'M-Policy unavailable'
      )
      if (policyUnavailable) return err(policyUnavailable.error)
      const auditUnavailable = helpers.ensureAuditAvailable(
        'audit.unavailable',
        'Audit Log unavailable'
      )
      if (auditUnavailable) return err(auditUnavailable.error)

      const record = state.secretRefs.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'secret.not_found', message: 'secret ref not found' })
      }

      const disabledAt = new Date().toISOString()
      record.status = 'disabled'
      record.updatedAt = disabledAt
      const currentVersion = latestSecretVersion(state.secretVersions, id)
      if (currentVersion && !currentVersion.disabledAt) {
        currentVersion.disabledAt = disabledAt
      }
      return ok({ id, status: record.status, disabledAt })
    },
    async reference(id) {
      const record = state.secretRefs.find(candidate => candidate.id === id)
      if (!record) {
        return err({ code: 'secret.not_found', message: 'secret ref not found' })
      }

      const currentVersion = latestSecretVersion(state.secretVersions, id)
      if (!currentVersion) {
        return err({ code: 'secret.version.not_found', message: 'secret version not found' })
      }

      return ok({
        id,
        currentVersion: currentVersion.version,
        status: record.status,
        metadata: { ...record.metadata }
      })
    }
  }
}
