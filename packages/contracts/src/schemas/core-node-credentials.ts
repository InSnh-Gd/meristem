import * as Schema from 'effect/Schema'

export const IssueNodeCredentialResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  token: Schema.String,
  issuedAt: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type IssueNodeCredentialResponseFromSchema = typeof IssueNodeCredentialResponseSchema.Type

export const RevokeNodeCredentialResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  revokedAt: Schema.String,
  policyDecisionId: Schema.String,
  correlationId: Schema.String
})
export type RevokeNodeCredentialResponseFromSchema = typeof RevokeNodeCredentialResponseSchema.Type
