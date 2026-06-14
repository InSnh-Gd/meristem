import type { actors, actorTokenRevocations, actorTokens } from '../../../packages/db/src/schema.ts'

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

export function mapRevocationRow(
  row: typeof actorTokenRevocations.$inferSelect
): IdentityTokenRevocationRecord {
  return {
    jti: row.jti,
    revokedAt: row.revokedAt.toISOString(),
    revokedBy: row.revokedBy,
    reason: row.reason,
    ...(row.correlationId ? { correlationId: row.correlationId } : {})
  }
}
