import type { secretRefs, secretRefVersions } from '../../../packages/db/src/schema.ts'

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

/**
 * 统一把 jsonb metadata 规整成 string record，避免把非字符串值泄漏到 Core 边界。
 */
function toStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === 'string' ? [[key, entry]] : []
    )
  )
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

export function mapSecretRefVersionRow(
  row: typeof secretRefVersions.$inferSelect
): SecretRefVersionRecord {
  return {
    id: row.id,
    secretRefId: row.secretRefId,
    version: row.version,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    ...(row.disabledAt ? { disabledAt: row.disabledAt.toISOString() } : {})
  }
}
