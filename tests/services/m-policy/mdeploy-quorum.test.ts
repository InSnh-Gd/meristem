import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { ActorId } from '../../../packages/contracts/src/index.ts'
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
      const eligible: readonly ActorId[] = ['security-admin', 'break-glass-reviewer']
      return (
        eligible.includes(actor) &&
        (permission === 'policy:approval-approve' || permission === 'policy:approval-reject')
      )
    }
  }
}

function voteRequest(proposalId: string, actor: ActorId): Request {
  return new Request(
    `http://m-policy.internal/internal/v0/policy/mdeploy/approvals/${proposalId}/votes`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-meristem-internal-token': internalToken
      },
      body: JSON.stringify({
        proposalActor: 'admin',
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

    expect((await app.handle(voteRequest(proposalId, 'break-glass-reviewer'))).status).toBe(200)
    const twoVoteProof = await app.handle(proofRequest(proposalId))
    expect(twoVoteProof.status).toBe(200)
    expect(await twoVoteProof.json()).toMatchObject({
      proposalId,
      approvers: ['security-admin', 'break-glass-reviewer']
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
