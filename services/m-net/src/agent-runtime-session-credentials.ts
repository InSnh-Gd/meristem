import { and, eq } from 'drizzle-orm'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import { nodeCredentials } from '../../../packages/db/src/schema.ts'
import type { CredentialStore } from './agent-runtime-types.ts'

type NodeCredentialRow = typeof nodeCredentials.$inferSelect
type NodeCredentialUpdate = Partial<typeof nodeCredentials.$inferInsert>

/** 运行 token 校验所需的最小 PostgreSQL 访问能力。 */
export type RuntimeCredentialContext = {
  db: {
    select(): {
      from(table: typeof nodeCredentials): {
        where(condition: unknown): {
          limit(count: number): Promise<NodeCredentialRow[]>
        }
      }
    }
    update(table: typeof nodeCredentials): {
      set(values: NodeCredentialUpdate): {
        where(condition: unknown): Promise<unknown>
      }
    }
  }
}

/** 仅信任 PostgreSQL 中的 active 哈希记录校验 Agent 运行 token。 */
export async function validateNodeCredential(
  context: RuntimeCredentialContext,
  nodeId: string,
  token: string
): Promise<boolean> {
  const [credential] = await context.db
    .select()
    .from(nodeCredentials)
    .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
    .limit(1)
  if (!credential) return false
  const tokenHash = await hashNodeToken(token)
  if (tokenHash !== credential.tokenHash) return false
  await context.db
    .update(nodeCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(nodeCredentials.id, credential.id))
  return true
}

/** 签发一次性返回明文、持久化哈希和生命周期元数据的运行 token。 */
export async function issueRuntimeCredential(
  store: CredentialStore,
  nodeId: string
): Promise<{ token: string; issuedAt: string }> {
  const token = mintNodeToken()
  const tokenHash = await hashNodeToken(token)
  const now = new Date()
  await store
    .update(nodeCredentials)
    .set({ status: 'revoked', revokedAt: now })
    .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
  await store.insert(nodeCredentials).values({
    id: crypto.randomUUID(),
    nodeId,
    tokenHash,
    status: 'active',
    issuedAt: now
  })
  return { token, issuedAt: now.toISOString() }
}
