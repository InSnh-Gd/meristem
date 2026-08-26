import { t } from 'elysia'

const digestSchema = t.Object({
  algorithm: t.Union([t.Literal('sha256'), t.Literal('sha512')]),
  value: t.String({ minLength: 1 })
})

export const deployApplyBodySchema = t.Object({
  proposalId: t.String({ minLength: 1 }),
  agentId: t.String({ minLength: 1 })
})

export const deployRollbackBodySchema = t.Object({
  agentId: t.String({ minLength: 1 }),
  targetDigest: digestSchema
})
