import * as Schema from 'effect/Schema'
import { ActorIdSchema } from './identity.ts'
import { PermissionSchema } from './policy.ts'

export const DisabledCommandExplanationSchema = Schema.Struct({
  code: Schema.Literal('missing_permission', 'wrong_node_kind', 'node_unreachable'),
  message: Schema.String,
  missingPermission: Schema.optional(PermissionSchema)
})

export const MinimalPolicyDecisionSummarySchema = Schema.Struct({
  id: Schema.NonEmptyString,
  actor: ActorIdSchema,
  action: PermissionSchema,
  resource: Schema.NonEmptyString,
  result: Schema.Literal('allow', 'deny'),
  createdAt: Schema.NonEmptyString
})

export const CommandWellCommandSchema = Schema.Struct({
  id: Schema.Literal('task.noop.run'),
  label: Schema.String,
  action: PermissionSchema,
  resource: Schema.NonEmptyString,
  risk: Schema.Literal('medium'),
  requiredPermissions: Schema.Array(PermissionSchema),
  requiresPolicy: Schema.Boolean,
  requiresAudit: Schema.Boolean
})

export const CommandWellEligibilitySchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal('enabled'),
    command: CommandWellCommandSchema
  }),
  Schema.Struct({
    state: Schema.Literal('disabled'),
    disabled: DisabledCommandExplanationSchema,
    disabledReason: Schema.String
  })
)

export type DisabledCommandExplanation = typeof DisabledCommandExplanationSchema.Type
export type MinimalPolicyDecisionSummary = typeof MinimalPolicyDecisionSummarySchema.Type
export type CommandWellEligibility = typeof CommandWellEligibilitySchema.Type

