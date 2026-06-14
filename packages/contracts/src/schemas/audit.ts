import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'

export const AuditEntryCreatedPayloadSchema = Schema.Struct({
  auditId: Schema.String,
  actor: Schema.Union(Schema.Literal(...actorIds), Schema.Literal('system')),
  action: Schema.String,
  resource: Schema.String,
  decisionId: Schema.optional(Schema.String)
})
export type AuditEntryCreatedPayloadFromSchema = typeof AuditEntryCreatedPayloadSchema.Type
