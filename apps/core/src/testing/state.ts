import type { ActorId } from '../../../../packages/contracts/src/index.ts'
import {
  createBuiltinServices,
  createInitialActors,
  type IdentityTokenRecord,
  type InMemoryCoreTestingHelpers,
  type InMemoryCoreTestingState,
  type InMemoryOptions
} from './shared.ts'

function markExpiredToken(record: IdentityTokenRecord): IdentityTokenRecord {
  if (record.status === 'active' && Date.parse(record.expiresAt) <= Date.now()) {
    record.status = 'expired'
    record.updatedAt = new Date().toISOString()
  }

  return record
}

/**
 * createInMemoryCoreTestingContext 统一组装测试工厂共享状态，
 * 让各个端口模块只关心自己的行为而不再维护重复闭包。
 */
export function createInMemoryCoreTestingContext(options: InMemoryOptions = {}): {
  actor: ActorId
  state: InMemoryCoreTestingState
  helpers: InMemoryCoreTestingHelpers
} {
  const actor = options.actor ?? 'operator'
  const now = new Date().toISOString()

  return {
    actor,
    state: {
      nodes: [],
      taskCount: { value: 0 },
      services: [],
      networks: [],
      memberships: [],
      timeline: [],
      audit: [],
      full: [],
      decisions: [],
      joinTickets: new Map(),
      nodeCredentials: new Map(),
      simulatedAgentExecutions: new Map(),
      actors: createInitialActors(now),
      actorTokens: [],
      secretRefs: [],
      secretVersions: [],
      configRecords: [],
      configVersions: [],
      configAcks: [],
      builtinServices: createBuiltinServices(options)
    },
    helpers: {
      actor,
      options,
      configOpsRequirePolicy() {
        return options.configPolicyRequired !== false
      },
      ensureAuditAvailable(code: string, message: string) {
        return options.auditAvailable === false
          ? { ok: false as const, error: { code, message } }
          : null
      },
      ensurePolicyAvailable(code: string, message: string) {
        return options.policyAvailable === false
          ? { ok: false as const, error: { code, message } }
          : null
      },
      markExpiredToken
    }
  }
}
