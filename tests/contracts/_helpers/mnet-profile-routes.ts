import * as Schema from 'effect/Schema'
import { mintLocalToken } from '../../../packages/auth/src/index.ts'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { internalTokenHeaderName } from '../../../packages/internal-http/src/index.ts'
import { createMNetApp } from '../../../services/m-net/src/app.ts'
import { createInMemoryGlobalDefaultsStore } from '../../../services/m-net/src/global-defaults-store.ts'
import { createMigrationEngine } from '../../../services/m-net/src/migration-engine.ts'
import type { ProfileStore } from '../../../services/m-net/src/profile-store.ts'
import type { MNetApp } from '../../../services/m-net/src/public-types.ts'
import type { SuspendedOperationStore } from '../../../services/m-net/src/suspended-operations.ts'

export const jwtSecret = 'test-jwt-secret'
export const internalToken = 'internal-test-token'

export function internalHeaders(): Record<string, string> {
  return { [internalTokenHeaderName]: internalToken }
}

export async function mintTestToken(actor: ActorId): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

export function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

export const ErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.optional(Schema.String)
  })
})

export async function decodeJson<TSchema extends Schema.Schema.AnyNoContext>(
  response: Response,
  schema: TSchema
): Promise<Schema.Schema.Type<TSchema>> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

export const inMemoryApprovalClient = {
  async create(_input: {
    policyDecisionId: string
    originService: string
    operationId: string
    requestedBy: string
    requiredAction: string
    quorumRequired: number
    expiresAt: string
  }): Promise<
    | { ok: true; value: { approvalId: string } }
    | { ok: false; error: { code: string; message: string } }
  > {
    return { ok: true, value: { approvalId: crypto.randomUUID() } }
  }
}

/** 内存日志收集器，用于测试中验证日志写入 */
export function createInMemoryTestLog() {
  const records: Array<{ kind: 'timeline' | 'full' | 'audit'; data: Record<string, unknown> }> = []

  return {
    records,
    log: {
      async writeTimeline(summary: string, subject?: string, correlationId?: string) {
        records.push({ kind: 'timeline', data: { summary, subject, correlationId } })
      },
      async writeFull(level: string, message: string, correlationId?: string, payload?: unknown) {
        records.push({ kind: 'full', data: { level, message, correlationId, payload } })
      },
      async writeAudit(
        actor: string,
        action: string,
        resource: string,
        result: string,
        correlationId?: string,
        payload?: unknown
      ) {
        records.push({
          kind: 'audit',
          data: { actor, action, resource, result, correlationId, payload }
        })
      }
    }
  }
}

export function createTestApp(
  profileStore: ProfileStore,
  suspendedOps: SuspendedOperationStore,
  policyAuthorizeOverrides?: {
    authorize(
      _actor: string,
      _action: string,
      _resource: string
    ): Promise<{
      result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
      id: string
      reasons: string[]
    }>
  }
): MNetApp {
  const globalDefaultsStore = createInMemoryGlobalDefaultsStore(profileStore)
  const { log } = createInMemoryTestLog()

  const defaultPolicy = policyAuthorizeOverrides ?? {
    async authorize(_actor, action, _resource) {
      // 全局默认操作和批量迁移操作默认 allow（测试用）
      if (
        action === 'network:profile-read' ||
        action === 'network:profile-defaults-set' ||
        action === 'network:profile-switch-plan' ||
        action === 'network:profile-switch-apply' ||
        action === 'network:profile-switch-resume' ||
        action === 'network:profile-switch-rollback'
      ) {
        return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
      }
      return { result: 'require_manual_review' as const, id: crypto.randomUUID(), reasons: [] }
    }
  }

  const migrationEngine = createMigrationEngine({
    globalDefaultsStore,
    profileStore,
    async writeAudit(input) {
      await log.writeAudit(
        input.actor,
        input.action,
        input.resource,
        input.result,
        input.correlationId,
        input.metadata
      )
      return input.correlationId
    },
    async writeFull(input) {
      await log.writeFull(input.level, input.message, input.correlationId, input.metadata)
    }
  })

  return createMNetApp({
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listNetworks() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listMembers() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    profileStore,
    suspendedOps,
    approvals: inMemoryApprovalClient,
    policyAuthorize: defaultPolicy,
    globalDefaultsStore,
    migrationEngine,
    log,
    events: {
      async publish() {
        /* noop for tests */
      }
    }
  })
}
