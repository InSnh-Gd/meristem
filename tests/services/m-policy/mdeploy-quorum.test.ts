import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ActorId } from '../../../packages/contracts/src/index.ts'
import { rolePermissions } from '../../../packages/policy/src/index.ts'
import { createInMemoryApprovalStore } from '../../../services/m-policy/src/approval-helpers.ts'
import type { ApprovalDeps } from '../../../services/m-policy/src/approval-schemas.ts'
import { createMDeployApprovalRoutes } from '../../../services/m-policy/src/mdeploy-approvals.ts'

const internalToken = 'mdeploy-policy-quorum-token'
let previousInternalToken: string | undefined

function deps(): ApprovalDeps {
  return {
    auth: {
      async verify() {
        return { ok: true, actor: 'security-admin' }
      }
    },
    approvals: createInMemoryApprovalStore(),
    log: {
      async writeTimeline() {},
      async writeFull() {},
      async writeAudit() {}
    },
    events: {
      async publish() {}
    },
    async authorize(actor, permission) {
      return rolePermissions[actor].includes(permission)
    }
  }
}

function voteRequest(
  proposalId: string,
  actor: ActorId,
  proposalActor: ActorId = 'admin'
): Request {
  return new Request(
    `http://m-policy.internal/internal/v0/policy/mdeploy/approvals/${proposalId}/votes`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-meristem-internal-token': internalToken
      },
      body: JSON.stringify({
        proposalActor,
        policyDecisionId: 'decision-quorum',
        actor,
        result: 'approve',
        expiresAt: '2099-07-14T00:00:00.000Z'
      })
    }
  )
}

function proofRequest(proposalId: string): Request {
  return new Request(
    `http://m-policy.internal/internal/v0/policy/mdeploy/approvals/${proposalId}/quorum`,
    {
      method: 'POST',
      headers: { 'x-meristem-internal-token': internalToken }
    }
  )
}

beforeEach(() => {
  previousInternalToken = process.env.MERISTEM_INTERNAL_TOKEN
  process.env.MERISTEM_INTERNAL_TOKEN = internalToken
})

afterEach(() => {
  if (previousInternalToken === undefined) delete process.env.MERISTEM_INTERNAL_TOKEN
  else process.env.MERISTEM_INTERNAL_TOKEN = previousInternalToken
})

describe('M-Policy M-Deploy quorum authority', () => {
  it('withholds proof after one vote and returns the durable approval ID after two distinct votes', async () => {
    const app = createMDeployApprovalRoutes(deps())
    const proposalId = `proposal-${crypto.randomUUID()}`

    expect((await app.handle(voteRequest(proposalId, 'security-admin'))).status).toBe(200)
    const oneVoteProof = await app.handle(proofRequest(proposalId))
    expect(oneVoteProof.status).toBe(409)
    expect(await oneVoteProof.json()).toMatchObject({
      error: { code: 'policy.quorum_not_satisfied' }
    })

    expect((await app.handle(voteRequest(proposalId, 'security-admin-2'))).status).toBe(200)
    const twoVoteProof = await app.handle(proofRequest(proposalId))
    expect(twoVoteProof.status).toBe(200)
    expect(await twoVoteProof.json()).toMatchObject({
      proposalId,
      approvers: ['security-admin', 'security-admin-2']
    })
  })

  it('rejects operator, admin, and break-glass identities as M-Deploy approvers', async () => {
    const app = createMDeployApprovalRoutes(deps())

    for (const actor of [
      'operator',
      'admin',
      'break-glass-reviewer'
    ] satisfies readonly ActorId[]) {
      const response = await app.handle(voteRequest(`proposal-${actor}`, actor))

      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        error: { code: 'policy.approver_ineligible' }
      })
    }
  })

  it('rejects proposer self-approval and duplicate M-Deploy votes', async () => {
    const app = createMDeployApprovalRoutes(deps())
    const selfProposalId = `proposal-self-${crypto.randomUUID()}`
    const duplicateProposalId = `proposal-duplicate-${crypto.randomUUID()}`

    const selfApproval = await app.handle(
      voteRequest(selfProposalId, 'security-admin', 'security-admin')
    )
    expect(selfApproval.status).toBe(403)
    expect(await selfApproval.json()).toMatchObject({
      error: { code: 'approval.self_vote_denied' }
    })

    expect((await app.handle(voteRequest(duplicateProposalId, 'security-admin'))).status).toBe(200)
    const duplicateApproval = await app.handle(voteRequest(duplicateProposalId, 'security-admin'))
    expect(duplicateApproval.status).toBe(409)
    expect(await duplicateApproval.json()).toMatchObject({
      error: { code: 'approval.duplicate_vote' }
    })
  })

  it('returns a typed unavailable outcome when the policy approval store fails', async () => {
    const unavailable = deps()
    unavailable.approvals.listApprovals = async () => {
      throw new Error('policy database unavailable')
    }
    const app = createMDeployApprovalRoutes(unavailable)

    const response = await app.handle(proofRequest('proposal-unavailable'))

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: { code: 'policy.unavailable' } })
  })
})
