import type { StoredProfileMigration } from './data-plane-store-types.ts'

export function toStoredProfileMigrationRecord(
  input: {
    networkId: string
    fromVersion: string
    toVersion: string
    operationId: string
    status: string
    timestamp: string
    auditMetadata: Record<string, unknown>
  },
  existingStartedAt?: string
): StoredProfileMigration {
  return {
    networkId: input.networkId,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    operationId: input.operationId,
    status: input.status,
    idempotencyKey: `${input.operationId}:${input.networkId}`,
    startedAt: existingStartedAt ?? input.timestamp,
    ...(input.status === 'applied' || input.status === 'pending' || input.status === 'rolled_back'
      ? { completedAt: input.timestamp }
      : {}),
    auditMetadata: input.auditMetadata
  }
}
