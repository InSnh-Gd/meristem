import { describe, expect, it } from 'bun:test'
import {
  createApprovalWriterPort,
  createNetworkProfileWriterPort
} from '../../apps/core/src/testing/approval-profile-writers.ts'

const context = {
  actor: 'security-admin' as const,
  bearerToken: 'token-1',
  correlationId: 'corr-1'
}

describe('in-memory approval/profile writer ports', () => {
  it('covers approval not-found and conflict branches', async () => {
    const notFound = createApprovalWriterPort({ notFoundApprovalIds: new Set(['missing']) })
    const approveConflict = createApprovalWriterPort({ approveSucceeds: false })
    const rejectConflict = createApprovalWriterPort({ rejectSucceeds: false })

    const notFoundResult = await notFound.approve('missing', {}, context)
    const approveConflictResult = await approveConflict.approve('a1', {}, context)
    const rejectConflictResult = await rejectConflict.reject('a1', {}, context)

    expect(notFoundResult.ok).toBe(false)
    expect(approveConflictResult.ok).toBe(false)
    expect(rejectConflictResult.ok).toBe(false)
  })

  it('covers profile conflict and unavailable branches', async () => {
    const conflict = createNetworkProfileWriterPort({ conflictNetworkIds: new Set(['net-conflict']) })
    const unavailable = createNetworkProfileWriterPort({ profileSetSucceeds: false })

    const conflictResult = await conflict.setProfile('net-conflict', { profileVersion: 'm-net-cn@0.1.0', reason: 'x' }, context)
    const unavailableResult = await unavailable.setProfile('net-1', { profileVersion: 'm-net-cn@0.1.0', reason: 'x' }, context)

    expect(conflictResult.ok).toBe(false)
    expect(unavailableResult.ok).toBe(false)
  })
})
