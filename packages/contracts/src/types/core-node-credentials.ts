export type IssueNodeCredentialResponse = {
  nodeId: string
  token: string
  issuedAt: string
  policyDecisionId: string
  correlationId: string
}

export type RevokeNodeCredentialResponse = {
  nodeId: string
  revokedAt: string
  policyDecisionId: string
  correlationId: string
}
