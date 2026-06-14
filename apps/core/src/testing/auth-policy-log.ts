import { err, ok } from '../../../../packages/common/src/result.ts'
import { decidePermission, rolePermissions } from '../../../../packages/policy/src/index.ts'
import type { AuthPort, EventPort, LogPort, PolicyPort } from '../types.ts'
import type { InMemoryCoreTestingHelpers, InMemoryCoreTestingState } from './shared.ts'
import { decodeMockJwt } from './shared.ts'

/**
 * createAuthPort 复用测试态 token 表，保证认证错误与生产边界保持同一语义。
 */
export function createAuthPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): AuthPort {
  return {
    async verify(token) {
      const staticActor =
        token === 'viewer-token'
          ? 'viewer'
          : token === 'operator-token'
            ? 'operator'
            : token === 'admin-token'
              ? 'admin'
              : token === 'security-admin-token'
                ? 'security-admin'
                : token === 'test-token'
                  ? helpers.actor
                  : null

      if (staticActor) {
        if (
          helpers.options.introspectionAvailable === false ||
          (helpers.options.policyAvailable === false && token === 'IDY-FM-INTROSPECT-down-token')
        ) {
          return {
            ok: false as const,
            code: 'identity.introspection.unavailable',
            message: 'identity introspection unavailable'
          }
        }

        return { ok: true as const, actor: staticActor }
      }

      if (helpers.options.policyAvailable === false && token === 'IDY-FM-INTROSPECT-down-token') {
        return {
          ok: false as const,
          code: 'identity.introspection.unavailable',
          message: 'identity introspection unavailable'
        }
      }

      const decoded = decodeMockJwt(token)
      if (decoded === null) {
        return { ok: false as const, code: 'invalid_token', message: 'JWT verification failed' }
      }

      const record = state.actorTokens.find(
        candidate => candidate.jti === decoded.jti && candidate.token === token
      )
      if (!record) {
        return { ok: false as const, code: 'invalid_token', message: 'JWT verification failed' }
      }

      const current = helpers.markExpiredToken(record)
      if (current.status === 'revoked') {
        return {
          ok: false as const,
          code: 'identity.token.revoked',
          message: 'identity token has been revoked',
          actor: current.actor,
          jti: current.jti
        }
      }
      if (current.status === 'expired') {
        return {
          ok: false as const,
          code: 'expired_token',
          message: 'JWT has expired',
          actor: current.actor,
          jti: current.jti
        }
      }

      const actorRecord = state.actors.find(candidate => candidate.id === current.actor)
      if (actorRecord?.status !== 'active') {
        return {
          ok: false as const,
          code: 'invalid_actor',
          message: 'identity actor is not active',
          actor: current.actor,
          jti: current.jti
        }
      }

      return { ok: true as const, actor: current.actor }
    },
    async getPermissions() {
      return ok(
        (rolePermissions[helpers.actor] ??
          []) as import('../../../../packages/contracts/src/index.ts').Permission[]
      )
    }
  }
}

/**
 * createPolicyPort 直接调用同一套纯权限决策函数，避免测试桩与真实授权规则分叉。
 */
export function createPolicyPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): PolicyPort {
  return {
    async authorize(input) {
      if (helpers.options.policyAvailable === false) {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }

      const draft = decidePermission({
        actor: input.actor,
        action: input.action,
        resource: input.resource,
        permissions: rolePermissions[
          input.actor
        ] as readonly import('../../../../packages/contracts/src/index.ts').Permission[]
      })
      const decision = {
        ...draft,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString()
      }
      state.decisions.push(decision)
      return ok(decision)
    },
    async getDecision(id: string) {
      return ok(state.decisions.find(decision => decision.id === id) ?? null)
    }
  }
}

/**
 * createLogPort 保留 Timeline / Full / Audit 的分层语义，并显式暴露搜索降级行为。
 */
export function createLogPort(
  state: InMemoryCoreTestingState,
  helpers: InMemoryCoreTestingHelpers
): LogPort {
  return {
    async writeTimeline(input) {
      const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
      state.timeline.unshift(entry)
      return ok(entry)
    },
    async writeFull(input) {
      const entry = { id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...input }
      state.full.unshift(entry)
      return ok(entry)
    },
    async writeAudit(input) {
      if (helpers.options.auditAvailable === false) {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
      const entry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        summary: `${input.action} ${input.resource}`,
        ...input
      }
      state.audit.unshift(entry)
      return ok(entry)
    },
    async listTimeline() {
      return ok(state.timeline)
    },
    async listFull() {
      return ok(state.full)
    },
    async listAudit() {
      return ok(state.audit)
    },
    async searchFull(_query) {
      if (helpers.options.searchAvailable === false) {
        return err({ code: 'search.unavailable', message: 'search unavailable' })
      }
      return ok({ entries: [], total: 0 })
    },
    async searchTimeline(_query) {
      if (helpers.options.searchAvailable === false) {
        return err({ code: 'search.unavailable', message: 'search unavailable' })
      }
      return ok({ entries: [], total: 0 })
    },
    async searchAudit(_query) {
      if (helpers.options.searchAvailable === false) {
        return err({ code: 'search.unavailable', message: 'search unavailable' })
      }
      return ok({ entries: [], total: 0 })
    }
  }
}

export function createEventPort(): EventPort {
  return {
    async publish(_subject, event) {
      return ok({ eventId: event.id })
    }
  }
}
