import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

// Owning domain: identity.
export const actors = pgTable('actors', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
})

export const actorTokens = pgTable(
  'actor_tokens',
  {
    jti: text('jti').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id),
    issuer: text('issuer').notNull(),
    audience: text('audience').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    issuedBy: text('issued_by').notNull(),
    purpose: text('purpose').notNull(),
    status: text('status').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull()
  },
  table => [uniqueIndex('actor_tokens_jti_unique').on(table.jti)]
)

export const actorTokenRevocations = pgTable('actor_token_revocations', {
  jti: text('jti')
    .primaryKey()
    .references(() => actorTokens.jti),
  revokedAt: timestamp('revoked_at', { withTimezone: true }).notNull(),
  revokedBy: text('revoked_by').notNull(),
  reason: text('reason').notNull(),
  correlationId: text('correlation_id')
})
