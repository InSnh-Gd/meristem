import { jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import type {
  MDeployAgentRecord,
  MDeployEventIntent,
  MDeployOperation
} from '../../../../services/m-deploy/src/deps.ts'
import type {
  MDeployApprovalV01FromSchema,
  MDeployDriftReportV01FromSchema,
  MDeployEvidenceMetadataV01FromSchema,
  MDeployProposalV01FromSchema,
  MDeploySignedEnvelopeV01FromSchema
} from '../../../contracts/src/index.ts'

// Owning domain: M-Deploy. JSONB keeps versioned contract snapshots intact; status columns support recovery queries.
export const mdeployProposals = pgTable('mdeploy_proposals', {
  id: text('id').primaryKey(),
  approvalStatus: text('approval_status').notNull(),
  proposal: jsonb('proposal').$type<MDeployProposalV01FromSchema>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mdeployApprovals = pgTable('mdeploy_approvals', {
  id: text('id').primaryKey(),
  proposalId: text('proposal_id')
    .notNull()
    .references(() => mdeployProposals.id),
  approval: jsonb('approval').$type<MDeployApprovalV01FromSchema>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const mdeployOperations = pgTable('mdeploy_operations', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  publicationStatus: text('publication_status').notNull(),
  operation: jsonb('operation').$type<MDeployOperation>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mdeployEvidence = pgTable(
  'mdeploy_evidence',
  {
    operationId: text('operation_id').notNull(),
    evidenceType: text('evidence_type').notNull(),
    metadata: jsonb('metadata').$type<MDeployEvidenceMetadataV01FromSchema>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull()
  },
  table => [primaryKey({ columns: [table.operationId, table.evidenceType] })]
)

export const mdeployEventIntents = pgTable('mdeploy_event_intents', {
  id: text('id').primaryKey(),
  operationId: text('operation_id')
    .notNull()
    .references(() => mdeployOperations.id),
  status: text('status').notNull(),
  intent: jsonb('intent').$type<MDeployEventIntent>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mdeployAgents = pgTable('mdeploy_agents', {
  id: text('id').primaryKey(),
  record: jsonb('record').$type<MDeployAgentRecord>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mdeployDriftReports = pgTable('mdeploy_drift_reports', {
  id: text('id').primaryKey(),
  report: jsonb('report').$type<MDeployDriftReportV01FromSchema>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const mdeployVerifiedEnvelopes = pgTable('mdeploy_verified_envelopes', {
  digestKey: text('digest_key').primaryKey(),
  envelope: jsonb('envelope').$type<MDeploySignedEnvelopeV01FromSchema>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const mdeployLastSuccessful = pgTable('mdeploy_last_successful', {
  agentId: text('agent_id').primaryKey(),
  envelope: jsonb('envelope').$type<MDeploySignedEnvelopeV01FromSchema>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})
