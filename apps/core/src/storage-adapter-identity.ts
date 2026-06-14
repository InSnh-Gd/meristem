import { eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import { actors, actorTokenRevocations, actorTokens } from '../../../packages/db/src/schema.ts'
import {
  type CreateIdentityTokenInput,
  type IdentityActorRecord,
  type IdentityTokenRecord,
  type IdentityTokenRevocationRecord,
  mapActorRow,
  mapRevocationRow,
  mapTokenRow,
  type RevokeIdentityTokenInput
} from './storage-adapter-records.ts'

/**
 * Identity store 只暴露 actor 与 token 生命周期元数据，不返回任何敏感凭据明文。
 */
export function createIdentityStore(db: MeristemDb) {
  return {
    async listActors(): Promise<IdentityActorRecord[]> {
      const rows = await db.select().from(actors)
      return rows.map(mapActorRow)
    },
    async getActor(id: string): Promise<IdentityActorRecord | null> {
      const [row] = await db.select().from(actors).where(eq(actors.id, id)).limit(1)
      return row ? mapActorRow(row) : null
    },
    async createToken(input: CreateIdentityTokenInput): Promise<void> {
      const now = new Date()
      await db.insert(actorTokens).values({
        jti: input.jti,
        actorId: input.actorId,
        issuer: input.issuer,
        audience: input.audience,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        issuedBy: input.issuedBy,
        purpose: input.purpose,
        status: 'active',
        createdAt: now,
        updatedAt: now
      })
    },
    async getToken(jti: string): Promise<IdentityTokenRecord | null> {
      const [row] = await db.select().from(actorTokens).where(eq(actorTokens.jti, jti)).limit(1)
      return row ? mapTokenRow(row) : null
    },
    async revokeToken(input: RevokeIdentityTokenInput): Promise<void> {
      await db.insert(actorTokenRevocations).values({
        jti: input.jti,
        revokedAt: input.revokedAt,
        revokedBy: input.revokedBy,
        reason: input.reason,
        correlationId: input.correlationId
      })
      await db
        .update(actorTokens)
        .set({ status: 'revoked', updatedAt: input.revokedAt })
        .where(eq(actorTokens.jti, input.jti))
    },
    async getRevocation(jti: string): Promise<IdentityTokenRevocationRecord | null> {
      const [row] = await db
        .select()
        .from(actorTokenRevocations)
        .where(eq(actorTokenRevocations.jti, jti))
        .limit(1)
      return row ? mapRevocationRow(row) : null
    }
  }
}
