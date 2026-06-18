import { addMilliseconds } from 'date-fns'
import { err, ok } from '../../../../packages/common/src/result.ts'
import type { IdentityPort } from '../types.ts'
import {
  encodeMockJwt,
  type InMemoryCoreTestingHelpers,
  type InMemoryCoreTestingState,
  parseDurationMs
} from './shared.ts'

/**
 * createIdentityPort 让 actor 与 token 生命周期测试都复用同一份内存状态。
 */
export function createIdentityPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): IdentityPort {
  return {
    async listActors() {
      return ok(
        state.actors.map(({ id, displayName, status, createdAt, updatedAt }) => ({
          id,
          displayName,
          status,
          createdAt,
          updatedAt
        }))
      )
    },
    async getActor(id) {
      const record = state.actors.find(candidate => candidate.id === id)
      return ok(record ? { ...record } : null)
    },
    async issueToken(input) {
      const identityActor = state.actors.find(candidate => candidate.id === input.actor)
      if (!identityActor) {
        return err({ code: 'identity.actor.not_found', message: 'identity actor not found' })
      }

      const ttlMs = parseDurationMs(input.ttl)
      if (ttlMs === null) {
        return err({
          code: 'identity.ttl.invalid',
          message: 'identity token ttl must use ms/s/m/h/d units'
        })
      }

      const issuedAt = new Date().toISOString()
      const expiresAt = addMilliseconds(new Date(), ttlMs).toISOString()
      const jti = crypto.randomUUID()
      const token = encodeMockJwt({ jti, actor: input.actor })
      state.actorTokens.push({
        jti,
        token,
        actor: identityActor.id,
        issuer: 'meristem-local',
        audience: 'meristem-service',
        issuedAt,
        expiresAt,
        issuedBy: helpers.actor,
        purpose: input.purpose,
        status: 'active',
        createdAt: issuedAt,
        updatedAt: issuedAt,
        correlationId: input.correlationId
      })
      return ok({ jti, token, expiresAt, actor: identityActor.id })
    },
    async inspectToken(jti) {
      if (helpers.options.introspectionAvailable === false) {
        return err({
          code: 'identity.introspection.unavailable',
          message: 'identity introspection unavailable'
        })
      }

      const record = state.actorTokens.find(candidate => candidate.jti === jti)
      if (!record) return ok(null)

      const token = helpers.markExpiredToken(record)
      return ok({
        jti: token.jti,
        actor: token.actor,
        issuer: token.issuer,
        audience: token.audience,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        issuedBy: token.issuedBy,
        purpose: token.purpose,
        status: token.status,
        ...(token.revokedAt ? { revokedAt: token.revokedAt } : {}),
        ...(token.revokedBy ? { revokedBy: token.revokedBy } : {}),
        ...(token.revokeReason ? { revokeReason: token.revokeReason } : {})
      })
    },
    async revokeToken(jti, input) {
      const auditUnavailable = helpers.ensureAuditAvailable(
        'audit.unavailable',
        'Audit Log unavailable'
      )
      if (auditUnavailable) return err(auditUnavailable.error)

      const record = state.actorTokens.find(candidate => candidate.jti === jti)
      if (!record) {
        return err({ code: 'identity.token.not_found', message: 'identity token not found' })
      }

      const revokedAt = record.revokedAt ?? new Date().toISOString()
      record.status = 'revoked'
      record.revokedAt = revokedAt
      record.revokedBy = helpers.actor
      record.updatedAt = revokedAt
      record.revokeReason = input.reason
      return ok({ jti: record.jti, status: record.status, revokedAt, revokedBy: helpers.actor })
    },
    async introspect(jti) {
      if (helpers.options.introspectionAvailable === false) {
        return err({
          code: 'identity.introspection.unavailable',
          message: 'identity introspection unavailable'
        })
      }

      const record = state.actorTokens.find(candidate => candidate.jti === jti)
      if (!record) return ok({ active: false })

      const token = helpers.markExpiredToken(record)
      if (token.status !== 'active') return ok({ active: false })
      return ok({ active: true, actor: token.actor, jti: token.jti })
    }
  }
}
