import { describe, expect, it } from 'bun:test'
import type { ActorId, PolicyApproval } from '../../../packages/contracts/src/index.ts'
import {
  createInMemoryApprovalStore,
  createTestApproval,
  isApprovalExpired,
  isDuplicateVoteError,
  requireExternalActor,
  requirePermission,
  withUpdatedStatus
} from '../../../services/m-policy/src/approval-helpers.ts'
import type { ApprovalDeps } from '../../../services/m-policy/src/approval-schemas.ts'

const createDeps = (
  verifyResult: { ok: true; actor: ActorId } | { ok: false; code: string; message: string },
  allowed = true
): ApprovalDeps => ({
  auth: {
    verify: async () => verifyResult
  },
  approvals: createInMemoryApprovalStore(),
  log: {
    writeTimeline: async () => undefined,
    writeFull: async () => undefined,
    writeAudit: async () => undefined
  },
  events: {
    publish: async () => undefined
  },
  authorize: async () => allowed
})

describe('approval helpers', () => {
  it('requires an external actor from a bearer token', async () => {
    const deps = createDeps({ ok: true, actor: 'operator' })

    await expect(requireExternalActor(deps, { authorization: 'Bearer token-1' })).resolves.toBe(
      'operator'
    )
  })

  it('rejects missing and invalid bearer tokens', async () => {
    const deps = createDeps({ ok: true, actor: 'operator' })
    const invalidDeps = createDeps({ ok: false, code: 'auth.invalid', message: 'invalid token' })

    await expect(requireExternalActor(deps, {})).rejects.toMatchObject({
      status: 401,
      code: 'auth.missing_token'
    })
    await expect(
      requireExternalActor(invalidDeps, { authorization: 'Bearer token-1' })
    ).rejects.toMatchObject({ status: 401, code: 'auth.invalid' })
  })

  it('requires permission through the authorize dependency', async () => {
    await expect(
      requirePermission(
        createDeps({ ok: true, actor: 'operator' }),
        'operator',
        'policy:approval-read',
        'policy:approvals'
      )
    ).resolves.toBeUndefined()

    await expect(
      requirePermission(
        createDeps({ ok: true, actor: 'operator' }, false),
        'operator',
        'policy:approval-read',
        'policy:approvals'
      )
    ).rejects.toMatchObject({ status: 403, code: 'policy.denied' })
  })

  it('detects expired approvals by timestamp', () => {
    const now = new Date('2026-06-15T12:00:00.000Z')

    expect(
      isApprovalExpired(createTestApproval({ expiresAt: '2026-06-15T11:59:59.999Z' }), now)
    ).toBe(true)
    expect(
      isApprovalExpired(createTestApproval({ expiresAt: '2026-06-15T12:00:00.000Z' }), now)
    ).toBe(false)
  })

  it('detects duplicate vote errors from errors and non-error values', () => {
    expect(isDuplicateVoteError(new Error('duplicate vote'))).toBe(true)
    expect(isDuplicateVoteError('duplicate key')).toBe(true)
    expect(isDuplicateVoteError(new Error('other failure'))).toBe(false)
  })

  it('creates and mutates approvals in memory without external dependencies', async () => {
    const initial = createTestApproval({ id: 'approval-1', status: 'pending' })
    const store = createInMemoryApprovalStore([initial])
    const created = await store.createApproval({
      policyDecisionId: 'decision-1',
      originService: 'm-task',
      operationId: 'operation-1',
      requestedBy: 'operator',
      requiredAction: 'multi_approval',
      quorumRequired: 2,
      expiresAt: '2026-06-15T13:00:00.000Z'
    })

    expect(created).toMatchObject({
      policyDecisionId: 'decision-1',
      status: 'pending',
      quorumRequired: 2
    })
    expect(await store.listApprovals()).toHaveLength(2)
    expect(await store.listApprovals('pending')).toHaveLength(2)
    expect(await store.getApproval('approval-1')).toEqual(initial)
    expect(await store.getApproval('missing')).toBeNull()

    const vote = await store.addVote('approval-1', 'admin', 'approve', 'looks good')

    expect(vote).toMatchObject({
      approvalId: 'approval-1',
      actor: 'admin',
      vote: 'approve',
      reason: 'looks good'
    })
    expect(await store.getVotes('approval-1')).toEqual([vote])
    await expect(store.addVote('approval-1', 'admin', 'reject')).rejects.toThrow('duplicate vote')

    const completedAt = '2026-06-15T12:30:00.000Z'
    const updated = await store.updateApprovalStatus('approval-1', 'approved', completedAt)

    expect(updated).toMatchObject({
      id: 'approval-1',
      status: 'approved',
      completedAt
    })
    expect(updated?.updatedAt).toEqual(expect.any(String))
    await expect(store.updateApprovalStatus('missing', 'approved')).resolves.toBeNull()
  })

  it('creates a pending test approval with overrides', () => {
    const approval = createTestApproval({
      id: 'approval-1',
      requestedBy: 'admin',
      quorumRequired: 3
    })

    expect(approval).toMatchObject({
      id: 'approval-1',
      requestedBy: 'admin',
      status: 'pending',
      quorumRequired: 3
    })
  })

  it('returns approvals with updated status without mutating the input', () => {
    const approval: PolicyApproval = createTestApproval({ id: 'approval-1', status: 'pending' })
    const completedAt = '2026-06-15T12:30:00.000Z'

    expect(withUpdatedStatus(approval, 'rejected', completedAt)).toEqual({
      ...approval,
      status: 'rejected',
      updatedAt: completedAt,
      completedAt
    })
    expect(approval.status).toBe('pending')
  })
})
