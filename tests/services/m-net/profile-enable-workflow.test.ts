import { describe, expect, it } from 'bun:test'
import type { MNetAppDeps } from '../../../services/m-net/src/deps.ts'
import { requestEnableProfile } from '../../../services/m-net/src/profile-enable-workflow.ts'

function createProfileStore(): NonNullable<MNetAppDeps['profileStore']> {
  return {
    async getDefinitions() {
      return []
    },
    async getDefinition() {
      return null
    },
    async getNetworkState() {
      return null
    },
    async setNetworkState() {},
    async recordTransition() {},
    async listNetworkStates() {
      return []
    }
  }
}

function createPolicyAuthorize(
  result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
): NonNullable<MNetAppDeps['policyAuthorize']> {
  return {
    async authorize() {
      return { result, id: 'decision-1', reasons: result === 'deny' ? ['blocked'] : [] }
    }
  }
}

function createSuspendedOps(): NonNullable<MNetAppDeps['suspendedOps']> {
  return {
    async create(input) {
      return {
        id: 'op-1',
        policyDecisionId: input.policyDecisionId,
        action: input.action,
        networkId: input.networkId,
        fromProfileVersion: input.fromProfileVersion,
        toProfileVersion: input.toProfileVersion,
        requestedBy: input.requestedBy,
        requestedAt: new Date().toISOString(),
        reason: input.reason,
        status: 'pending',
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt
      }
    },
    async get() {
      return null
    },
    async transition() {
      return null
    }
  }
}

function createApprovals(): NonNullable<MNetAppDeps['approvals']> {
  return {
    async create() {
      return { ok: true, value: { approvalId: 'approval-1' } }
    }
  }
}

describe('requestEnableProfile', () => {
  it('rejects invalid state transitions before touching approval flow', async () => {
    const result = await requestEnableProfile(
      {
        profileStore: createProfileStore(),
        policyAuthorize: createPolicyAuthorize('allow'),
        suspendedOps: createSuspendedOps(),
        approvals: createApprovals()
      },
      {
        actor: 'operator',
        networkId: 'net-1',
        state: {
          networkId: 'net-1',
          profileVersion: 'm-net-default@0.1.0',
          status: 'enabled',
          updatedAt: new Date().toISOString()
        },
        profileVersion: 'm-net-cn@0.1.0',
        reason: 'switch profile'
      }
    )

    expect(result).toEqual({
      kind: 'failure',
      status: 409,
      error: {
        code: 'profile.enable.invalid_state',
        message: 'cannot enable from enabled'
      }
    })
  })

  it('creates a pending approval flow for non-allow policy decisions', async () => {
    const transitions: Array<{ toStatus: string }> = []
    const result = await requestEnableProfile(
      {
        profileStore: {
          ...createProfileStore(),
          async recordTransition(record) {
            transitions.push({ toStatus: record.toStatus })
          }
        },
        policyAuthorize: createPolicyAuthorize('require_manual_review'),
        suspendedOps: createSuspendedOps(),
        approvals: createApprovals()
      },
      {
        actor: 'operator',
        networkId: 'net-1',
        state: {
          networkId: 'net-1',
          profileVersion: 'm-net-default@0.1.0',
          status: 'disabled',
          updatedAt: new Date().toISOString()
        },
        profileVersion: 'm-net-cn@0.1.0',
        reason: 'switch profile'
      }
    )

    expect(result.status).toBe('pending_approval')
    expect(transitions).toEqual([{ toStatus: 'enabling' }])
  })
})
