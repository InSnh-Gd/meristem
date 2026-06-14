import { desc, eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  secretRefs,
  secretRefTransitions,
  secretRefVersions
} from '../../../packages/db/src/schema.ts'
import {
  type CreateSecretRefInput,
  type CreateSecretRefVersionInput,
  mapSecretRefRow,
  mapSecretRefVersionRow,
  type RecordSecretRefTransitionInput,
  type SecretRefRecord,
  type SecretRefVersionRecord
} from './storage-adapter-records.ts'

/**
 * SecretRef store 只返回 metadata 与版本引用；密文仅写入版本表，不通过查询接口返回。
 */
export function createSecretRefStore(db: MeristemDb) {
  return {
    async list(): Promise<SecretRefRecord[]> {
      const rows = await db.select().from(secretRefs)
      return rows.map(mapSecretRefRow)
    },
    async get(id: string): Promise<SecretRefRecord | null> {
      const [row] = await db.select().from(secretRefs).where(eq(secretRefs.id, id)).limit(1)
      return row ? mapSecretRefRow(row) : null
    },
    async create(input: CreateSecretRefInput): Promise<void> {
      await db.insert(secretRefs).values({
        id: input.id || crypto.randomUUID(),
        name: input.name,
        scope: input.scope,
        status: input.status,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
        metadata: input.metadata
      })
    },
    async createVersion(input: CreateSecretRefVersionInput): Promise<void> {
      await db.insert(secretRefVersions).values({
        id: input.id || crypto.randomUUID(),
        secretRefId: input.secretRefId,
        version: input.version,
        valueCiphertext: input.valueCiphertext,
        createdBy: input.createdBy,
        createdAt: input.createdAt
      })
    },
    async getLatestVersion(secretRefId: string): Promise<SecretRefVersionRecord | null> {
      const [row] = await db
        .select()
        .from(secretRefVersions)
        .where(eq(secretRefVersions.secretRefId, secretRefId))
        .orderBy(desc(secretRefVersions.version))
        .limit(1)
      return row ? mapSecretRefVersionRow(row) : null
    },
    async updateStatus(id: string, status: string): Promise<void> {
      await db
        .update(secretRefs)
        .set({ status, updatedAt: new Date() })
        .where(eq(secretRefs.id, id))
    },
    async recordTransition(input: RecordSecretRefTransitionInput): Promise<void> {
      await db.insert(secretRefTransitions).values({
        id: input.id || crypto.randomUUID(),
        secretRefId: input.secretRefId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actor: input.actor,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.policyDecisionId ? { policyDecisionId: input.policyDecisionId } : {}),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        createdAt: input.createdAt
      })
    }
  }
}
