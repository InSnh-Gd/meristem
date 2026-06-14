import type { EventContract, ResponseContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

export const mPolicyEventContracts: EventContract[] = [
  'created',
  'approved',
  'rejected',
  'expired'
].map(status => ({
  subject: `policy.approval.${status}.v0`,
  schema: Contracts.PolicyApprovalEventPayloadSchema,
  fixture: {
    approvalId: `approval-${status}`,
    policyDecisionId: 'pd-approval',
    originService: 'm-net',
    operationId: 'op-approval',
    requestedBy: 'operator',
    requiredAction: 'manual_review',
    status: status === 'created' ? 'pending' : status
  }
}))

export const mPolicyResponseContracts: ResponseContract[] = [
  {
    route: 'GET /api/v0/policy/decisions/:id',
    schema: Contracts.PolicyDecisionResponseSchema,
    fixture: {
      decision: {
        id: 'pd-8',
        actor: 'admin',
        action: 'core:read',
        resource: 'core',
        result: 'allow',
        reasons: [],
        createdAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'POST /api/v0/policy/approvals',
    schema: Contracts.ApprovalCreateResponseSchema,
    fixture: {
      approval: {
        id: 'approval-1',
        policyDecisionId: 'pd-approval',
        originService: 'm-task',
        operationId: 'op-approval',
        requestedBy: 'operator',
        requiredAction: 'manual_review',
        status: 'pending',
        quorumRequired: 1,
        expiresAt: '2026-06-04T12:00:00.000Z',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:00:00.000Z'
      }
    }
  },
  {
    route: 'GET /api/v0/policy/approvals',
    schema: Contracts.ApprovalListResponseSchema,
    fixture: {
      approvals: [
        {
          id: 'approval-1',
          policyDecisionId: 'pd-approval',
          originService: 'm-task',
          operationId: 'op-approval',
          requestedBy: 'operator',
          requiredAction: 'manual_review',
          status: 'pending',
          quorumRequired: 1,
          expiresAt: '2026-06-04T12:00:00.000Z',
          createdAt: '2026-06-04T10:00:00.000Z',
          updatedAt: '2026-06-04T10:00:00.000Z'
        }
      ]
    }
  },
  {
    route: 'GET /api/v0/policy/approvals/:id',
    schema: Contracts.ApprovalDetailResponseSchema,
    fixture: {
      id: 'approval-1',
      policyDecisionId: 'pd-approval',
      originService: 'm-task',
      operationId: 'op-approval',
      requestedBy: 'operator',
      requiredAction: 'manual_review',
      status: 'pending',
      quorumRequired: 1,
      expiresAt: '2026-06-04T12:00:00.000Z',
      createdAt: '2026-06-04T10:00:00.000Z',
      updatedAt: '2026-06-04T10:00:00.000Z',
      votes: [
        {
          id: 'vote-1',
          approvalId: 'approval-1',
          actor: 'security-admin',
          vote: 'approve',
          createdAt: '2026-06-04T10:30:00.000Z'
        }
      ]
    }
  },
  {
    route: 'POST /api/v0/policy/approvals/:id/approve',
    schema: Contracts.ApprovalActionResponseSchema,
    fixture: {
      approval: {
        id: 'approval-1',
        policyDecisionId: 'pd-approval',
        originService: 'm-task',
        operationId: 'op-approval',
        requestedBy: 'operator',
        requiredAction: 'manual_review',
        status: 'approved',
        quorumRequired: 1,
        expiresAt: '2026-06-04T12:00:00.000Z',
        createdAt: '2026-06-04T10:00:00.000Z',
        updatedAt: '2026-06-04T10:30:00.000Z',
        completedAt: '2026-06-04T10:30:00.000Z'
      },
      votes: [
        {
          id: 'vote-1',
          approvalId: 'approval-1',
          actor: 'security-admin',
          vote: 'approve',
          createdAt: '2026-06-04T10:30:00.000Z'
        }
      ]
    }
  }
]
