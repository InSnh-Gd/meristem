import type {
  configApplyAcks,
  configRecords,
  configVersions
} from '../../../packages/db/src/schema.ts'

export type ConfigRecord = {
  id: string
  configVersion: string
  schemaVersion: string
  configHash: string
  domain: string
  targetScope: string[]
  status: string
  payload: unknown
  createdBy: string
  createdAt: string
  publishedBy?: string
  publishedAt?: string
  rollbackVersion?: string
  updatedAt: string
}

export type ConfigVersionRecord = {
  id: string
  configId: string
  version: string
  configHash: string
  payload: unknown
  status: string
  createdBy: string
  createdAt: string
}

export type ConfigAckRecord = {
  id: string
  configId: string
  version: string
  targetService: string
  status: string
  error?: string
  ackedAt?: string
  expiresAt?: string
  createdAt: string
}

export type CreateConfigInput = {
  id: string
  configVersion: string
  schemaVersion: string
  configHash: string
  domain: string
  targetScope: string[]
  status: string
  payload: unknown
  createdBy: string
  createdAt: Date
  rollbackVersion?: string
}

export type CreateConfigVersionInput = {
  id: string
  configId: string
  version: string
  configHash: string
  payload: unknown
  status: string
  createdBy: string
  createdAt: Date
}

export type UpdateConfigStatusExtra = {
  publishedBy?: string
  publishedAt?: Date
  rollbackVersion?: string
}

export type RecordConfigTransitionInput = {
  id: string
  configId: string
  fromStatus: string
  toStatus: string
  actor: string
  reason?: string
  policyDecisionId?: string
  correlationId?: string
  createdAt: Date
}

export type RecordConfigAckInput = {
  id: string
  configId: string
  version: string
  targetService: string
  status: string
  error?: string
  ackedAt?: Date
  expiresAt?: Date
  createdAt: Date
}

/**
 * config target scope 当前持久化为 jsonb；读取时统一收敛为 string[]，便于后续端口复用。
 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

export function mapConfigRow(row: typeof configRecords.$inferSelect): ConfigRecord {
  return {
    id: row.id,
    configVersion: row.configVersion,
    schemaVersion: row.schemaVersion,
    configHash: row.configHash,
    domain: row.domain,
    targetScope: toStringArray(row.targetScope),
    status: row.status,
    payload: row.payload,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    ...(row.publishedBy ? { publishedBy: row.publishedBy } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.toISOString() } : {}),
    ...(row.rollbackVersion ? { rollbackVersion: row.rollbackVersion } : {}),
    updatedAt: row.updatedAt.toISOString()
  }
}

export function mapConfigVersionRow(row: typeof configVersions.$inferSelect): ConfigVersionRecord {
  return {
    id: row.id,
    configId: row.configId,
    version: row.version,
    configHash: row.configHash,
    payload: row.payload,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString()
  }
}

export function mapConfigAckRow(row: typeof configApplyAcks.$inferSelect): ConfigAckRecord {
  return {
    id: row.id,
    configId: row.configId,
    version: row.version,
    targetService: row.targetService,
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
    ...(row.ackedAt ? { ackedAt: row.ackedAt.toISOString() } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    createdAt: row.createdAt.toISOString()
  }
}
