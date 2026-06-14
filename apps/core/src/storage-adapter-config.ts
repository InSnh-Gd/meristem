import { and, eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  configApplyAcks,
  configRecords,
  configTransitions,
  configVersions
} from '../../../packages/db/src/schema.ts'
import {
  type ConfigAckRecord,
  type ConfigRecord,
  type ConfigVersionRecord,
  type CreateConfigInput,
  type CreateConfigVersionInput,
  mapConfigAckRow,
  mapConfigRow,
  mapConfigVersionRow,
  type RecordConfigAckInput,
  type RecordConfigTransitionInput,
  type UpdateConfigStatusExtra
} from './storage-adapter-records.ts'

/**
 * Config store 负责配置权威记录、版本、发布确认与状态迁移，不把调用方绑定到表结构细节。
 */
export function createConfigStore(db: MeristemDb) {
  return {
    async list(): Promise<ConfigRecord[]> {
      const rows = await db.select().from(configRecords)
      return rows.map(mapConfigRow)
    },
    async get(id: string): Promise<ConfigRecord | null> {
      const [row] = await db.select().from(configRecords).where(eq(configRecords.id, id)).limit(1)
      return row ? mapConfigRow(row) : null
    },
    async create(input: CreateConfigInput): Promise<void> {
      await db.insert(configRecords).values({
        id: input.id || crypto.randomUUID(),
        configVersion: input.configVersion,
        schemaVersion: input.schemaVersion,
        configHash: input.configHash,
        domain: input.domain,
        targetScope: input.targetScope,
        status: input.status,
        payload: input.payload,
        createdBy: input.createdBy,
        createdAt: input.createdAt,
        ...(input.rollbackVersion ? { rollbackVersion: input.rollbackVersion } : {}),
        updatedAt: input.createdAt
      })
    },
    async createVersion(input: CreateConfigVersionInput): Promise<void> {
      await db.insert(configVersions).values({
        id: input.id || crypto.randomUUID(),
        configId: input.configId,
        version: input.version,
        configHash: input.configHash,
        payload: input.payload,
        status: input.status,
        createdBy: input.createdBy,
        createdAt: input.createdAt
      })
    },
    async updateStatus(id: string, status: string, extra?: UpdateConfigStatusExtra): Promise<void> {
      const publishedAt = extra?.publishedAt
      await db
        .update(configRecords)
        .set({
          status,
          ...(extra?.publishedBy ? { publishedBy: extra.publishedBy } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          ...(extra?.rollbackVersion ? { rollbackVersion: extra.rollbackVersion } : {}),
          updatedAt: publishedAt ?? new Date()
        })
        .where(eq(configRecords.id, id))
    },
    async recordTransition(input: RecordConfigTransitionInput): Promise<void> {
      await db.insert(configTransitions).values({
        id: input.id || crypto.randomUUID(),
        configId: input.configId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actor: input.actor,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.policyDecisionId ? { policyDecisionId: input.policyDecisionId } : {}),
        ...(input.correlationId ? { correlationId: input.correlationId } : {}),
        createdAt: input.createdAt
      })
    },
    async recordAck(input: RecordConfigAckInput): Promise<void> {
      await db.insert(configApplyAcks).values({
        id: input.id || crypto.randomUUID(),
        configId: input.configId,
        version: input.version,
        targetService: input.targetService,
        status: input.status,
        ...(input.error ? { error: input.error } : {}),
        ...(input.ackedAt ? { ackedAt: input.ackedAt } : {}),
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
        createdAt: input.createdAt
      })
    },
    async getAck(
      configId: string,
      targetService: string,
      version?: string
    ): Promise<ConfigAckRecord | null> {
      const [row] = await db
        .select()
        .from(configApplyAcks)
        .where(
          and(
            eq(configApplyAcks.configId, configId),
            eq(configApplyAcks.targetService, targetService),
            ...(version ? [eq(configApplyAcks.version, version)] : [])
          )
        )
        .limit(1)
      return row ? mapConfigAckRow(row) : null
    },
    async listAcks(configId: string, version?: string): Promise<ConfigAckRecord[]> {
      const rows = await db
        .select()
        .from(configApplyAcks)
        .where(
          and(
            eq(configApplyAcks.configId, configId),
            ...(version ? [eq(configApplyAcks.version, version)] : [])
          )
        )
      return rows.map(mapConfigAckRow)
    },
    async getVersion(configId: string, version: string): Promise<ConfigVersionRecord | null> {
      const [row] = await db
        .select()
        .from(configVersions)
        .where(and(eq(configVersions.configId, configId), eq(configVersions.version, version)))
        .limit(1)
      return row ? mapConfigVersionRow(row) : null
    },
    async getVersionByHash(configId: string, hash: string): Promise<ConfigVersionRecord | null> {
      const [row] = await db
        .select()
        .from(configVersions)
        .where(and(eq(configVersions.configId, configId), eq(configVersions.configHash, hash)))
        .limit(1)
      return row ? mapConfigVersionRow(row) : null
    }
  }
}
