import { integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Owning domain: policy.
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const roles = pgTable('roles', {
  id: text('id').primaryKey(),
  description: text('description').notNull()
})

export const permissions = pgTable('permissions', {
  id: text('id').primaryKey(),
  description: text('description').notNull()
})

export const userRoles = pgTable('user_roles', {
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id)
})

export const rolePermissions = pgTable('role_permissions', {
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id),
  permissionId: text('permission_id')
    .notNull()
    .references(() => permissions.id)
})

export const policyDecisions = pgTable('policy_decisions', {
  id: text('id').primaryKey(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  resource: text('resource').notNull(),
  result: text('result').notNull(),
  reasons: jsonb('reasons').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})

export const policyApprovals = pgTable('policy_approvals', {
  id: text('id').primaryKey(),
  policyDecisionId: text('policy_decision_id')
    .notNull()
    .references(() => policyDecisions.id),
  originService: text('origin_service').notNull(),
  operationId: text('operation_id').notNull(),
  requestedBy: text('requested_by').notNull(),
  requiredAction: text('required_action').notNull(),
  status: text('status').notNull(),
  quorumRequired: integer('quorum_required').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true })
})

export const policyApprovalVotes = pgTable('policy_approval_votes', {
  id: text('id').primaryKey(),
  approvalId: text('approval_id')
    .notNull()
    .references(() => policyApprovals.id),
  actor: text('actor').notNull(),
  vote: text('vote').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
})
