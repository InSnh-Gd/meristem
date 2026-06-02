import {
  actorTokenRevocations,
  actorTokens,
  actors,
  configApplyAcks,
  configRecords,
  configVersions,
  secretRefVersions,
  secretRefs
} from '../../../packages/db/src/schema.ts'

export type IdentityActorRecord = {
  id: string
  displayName: string
  status: string
  createdAt: string
  updatedAt: string
}

export type IdentityTokenRecord = {
  jti: string
  actorId: string
  issuer: string
  audience: string
  issuedAt: string
  expiresAt: string
  issuedBy: string
  purpose: string
  status: string
  createdAt: string
  updatedAt: string
}

export type IdentityTokenRevocationRecord = {
  jti: string
  revokedAt: string
  revokedBy: string
  reason: string
  correlationId?: string
}

export type CreateIdentityTokenInput = {
  jti: string
  actorId: string
  issuer: string
  audience: string
  issuedAt: Date
  expiresAt: Date
  issuedBy: string
  purpose: string
}

export type RevokeIdentityTokenInput = {
  jti: string
  revokedBy: string
  reason: string
  correlationId: string
  revokedAt: Date
}

export type SecretRefRecord = {
  id: string
  name: string
  scope: string
  status: string
  createdBy: string
  createdAt: string
  updatedAt: string
  metadata: Record<string, string>
}

export type SecretRefVersionRecord = {
  id: string
  secretRefId: string
  version: string
  createdBy: string
  createdAt: string
  disabledAt?: string
}

export type CreateSecretRefInput = {
  id: string
  name: string
  scope: string
  status: string
  createdBy: string
  metadata: Record<string, string>
  createdAt: Date
}

export type CreateSecretRefVersionInput = {
  id: string
  secretRefId: string
  version: string
  valueCiphertext: string
  createdBy: string
  createdAt: Date
}

export type RecordSecretRefTransitionInput = {
  id: string
  secretRefId: string
  fromStatus: string
  toStatus: string
  actor: string
  reason?: string
  policyDecisionId?: string
  correlationId?: string
  createdAt: Date
}

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
 * 统一把 jsonb metadata 规整成 string record，避免把非字符串值泄漏到 Core 边界。
 */
function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => typeof entry === 'string' ? [[key, entry]] : [])
  )
}

/**
 * config target scope 当前持久化为 jsonb；读取时统一收敛为 string[]，便于后续端口复用。
 */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

export function mapActorRow(row: typeof actors.$inferSelect): IdentityActorRecord {
  return {
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export function mapTokenRow(row: typeof actorTokens.$inferSelect): IdentityTokenRecord {
  return {
    jti: row.jti,
    actorId: row.actorId,
    issuer: row.issuer,
    audience: row.audience,
    issuedAt: row.issuedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    issuedBy: row.issuedBy,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export function mapRevocationRow(row: typeof actorTokenRevocations.$inferSelect): IdentityTokenRevocationRecord {
  return {
    jti: row.jti,
    revokedAt: row.revokedAt.toISOString(),
    revokedBy: row.revokedBy,
    reason: row.reason,
    ...(row.correlationId ? { correlationId: row.correlationId } : {})
  }
}

export function mapSecretRefRow(row: typeof secretRefs.$inferSelect): SecretRefRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: toStringRecord(row.metadata)
  }
}

export function mapSecretRefVersionRow(row: typeof secretRefVersions.$inferSelect): SecretRefVersionRecord {
  return {
    id: row.id,
    secretRefId: row.secretRefId,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    ...(row.disabledAt ? { disabledAt: row.disabledAt.toISOString() } : {})
  }
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
