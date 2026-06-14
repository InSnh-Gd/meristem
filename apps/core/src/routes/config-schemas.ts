import { t } from 'elysia'

export type ConfigStatus =
  | 'draft'
  | 'validated'
  | 'published'
  | 'applied'
  | 'failed'
  | 'rolled_back'

export type ConfigDomain = 'core' | 'm-net' | 'm-policy' | 'm-log' | 'm-extension' | 'm-ui'
export type AckStatus = 'acked' | 'failed'

export type ConfigListRecord = {
  id: string
  configVersion: string
  domain: ConfigDomain
  status: ConfigStatus
  createdBy: string
  createdAt: string
}

export type ConfigPortListRecord = Omit<ConfigListRecord, 'domain' | 'status'> & {
  domain: string
  status: string
}

export type ConfigDetailRecord = ConfigListRecord & {
  schemaVersion: string
  configHash: string
  targetScope: string[]
  payload: unknown
  updatedAt: string
  publishedBy?: string
  publishedAt?: string
  rollbackVersion?: string
}

export const configDomains = ['core', 'm-net', 'm-policy', 'm-log', 'm-extension', 'm-ui'] as const
export const configStatuses = [
  'draft',
  'validated',
  'published',
  'applied',
  'failed',
  'rolled_back'
] as const
export const ackStatuses = ['acked', 'failed'] as const

export const configParamsSchema = t.Object({
  id: t.String({ minLength: 1 })
})

export const configStatusSchema = t.UnionEnum(configStatuses)

export const configListRecordSchema = t.Object({
  id: t.String(),
  configVersion: t.String(),
  domain: t.UnionEnum(configDomains),
  status: configStatusSchema,
  createdBy: t.String(),
  createdAt: t.String()
})

export const _configDetailRecordSchema = t.Object({
  ...configListRecordSchema.properties,
  schemaVersion: t.String(),
  configHash: t.String(),
  targetScope: t.Array(t.String()),
  payload: t.Unknown(),
  updatedAt: t.String(),
  publishedBy: t.Optional(t.String()),
  publishedAt: t.Optional(t.String()),
  rollbackVersion: t.Optional(t.String())
})

export const configDraftBodySchema = t.Object({
  domain: t.UnionEnum(configDomains),
  payload: t.Unknown(),
  targetScope: t.Optional(t.Array(t.String()))
})

export const _configDraftResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    configVersion: t.String(),
    status: t.Literal('draft'),
    createdAt: t.String()
  })
})

export const _configValidateResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    status: t.Literal('validated')
  })
})

export const configPublishBodySchema = t.Object({
  reason: t.String({ minLength: 1 })
})

export const _configPublishResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    configVersion: t.String(),
    status: t.Literal('published'),
    publishedAt: t.String(),
    publishedBy: t.String()
  })
})

export const configRollbackBodySchema = t.Object({
  toVersion: t.String({ minLength: 1 }),
  reason: t.String({ minLength: 1 })
})

export const _configRollbackResponseSchema = t.Object({
  config: t.Object({
    id: t.String(),
    status: t.Literal('rolled_back')
  })
})

export const configApplyAckBodySchema = t.Object({
  version: t.Optional(t.String({ minLength: 1 })),
  configVersion: t.Optional(t.String({ minLength: 1 })),
  targetService: t.Optional(t.String({ minLength: 1 })),
  ackedBy: t.Optional(t.String({ minLength: 1 })),
  status: t.UnionEnum(ackStatuses),
  error: t.Optional(t.String()),
  errorCode: t.Optional(t.String()),
  errorMessage: t.Optional(t.String())
})

export const _configApplyAckResponseSchema = t.Object({
  ack: t.Object({
    ackId: t.String(),
    configId: t.String(),
    configVersion: t.String(),
    ackedBy: t.String(),
    status: t.UnionEnum(ackStatuses),
    ackedAt: t.String(),
    errorCode: t.Optional(t.String()),
    errorMessage: t.Optional(t.String())
  })
})
