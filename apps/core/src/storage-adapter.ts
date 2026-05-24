import { and, eq } from 'drizzle-orm'
import type {
  ActorId,
  CreateNodeTicketRequest,
  CoreDependencies,
  MNode,
  RegisterNodeRequest
} from '../../../packages/contracts/src/index.ts'
import { type MeristemDb } from '../../../packages/db/src/client.ts'
import { nodeCredentials, nodeJoinTickets, nodes, serviceDefinitions, tasks } from '../../../packages/db/src/schema.ts'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import type { CoreStorage } from './types.ts'

/**
 * 生成 join ticket 标识，用于节点加入 M 网络时的临时凭据。
 */
function createJoinTicket(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `mjt_${suffix}`
}

/**
 * createDbStorage 是 PostgreSQL 权威写模型适配器，所有节点、任务、凭据和服务元数据都在此落库。
 */
export function createDbStorage(db: MeristemDb, readinessChecks?: () => Promise<CoreDependencies>): CoreStorage {
  return {
    async readiness() {
      return readinessChecks ? readinessChecks() : {
        postgres: 'ready',
        nats: 'ready',
        'm-policy': 'ready',
        'm-log': 'ready',
        'm-eventbus': 'ready',
        'm-net': 'ready'
      }
    },
    async counts() {
      const [serviceRows, nodeRows, taskRows] = await Promise.all([
        db.select().from(serviceDefinitions),
        db.select().from(nodes),
        db.select().from(tasks)
      ])
      return { services: serviceRows.length, nodes: nodeRows.length, tasks: taskRows.length }
    },
    async registerNode(input: RegisterNodeRequest) {
      const now = new Date()
      const id = crypto.randomUUID()
      const mode = 'simulated'
      await db.insert(nodes).values({
        id,
        kind: input.kind,
        name: input.name,
        mode,
        status: 'healthy',
        reachability: 'reachable',
        capabilities: input.capabilities ?? [],
        scope: input.kind === 'leaf' ? ['restricted-api', 'restricted-interconnect'] : [],
        createdAt: now,
        updatedAt: now
      })
      return {
        id,
        kind: input.kind,
        name: input.name,
        mode,
        status: 'healthy',
        reachability: 'reachable',
        capabilities: input.capabilities ?? [],
        createdAt: now.toISOString()
      }
    },
    async createNodeTicket(input: CreateNodeTicketRequest & { createdBy: ActorId }) {
      const now = new Date()
      const expiresAt = new Date(now.getTime() + ((input.expiresInSeconds ?? 300) * 1000))
      const ticket = createJoinTicket()
      const ticketHash = await hashNodeToken(ticket)
      const ticketId = crypto.randomUUID()
      await db.insert(nodeJoinTickets).values({
        id: ticketId,
        ticketHash,
        kind: input.kind,
        name: input.name,
        capabilities: input.capabilities ?? [],
        status: 'active',
        expiresAt,
        createdBy: input.createdBy,
        createdAt: now
      })
      return {
        ticketId,
        ticket,
        expiresAt: expiresAt.toISOString()
      }
    },
    async issueNodeCredential(nodeId: string) {
      const [node] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
      if (!node) return null
      const token = mintNodeToken()
      const tokenHash = await hashNodeToken(token)
      const now = new Date()
      // 重签发会先撤销旧 token，确保每个节点同一时刻只有一个 active 凭据。
      await db
        .update(nodeCredentials)
        .set({ status: 'revoked', revokedAt: now })
        .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
      await db.insert(nodeCredentials).values({
        id: crypto.randomUUID(),
        nodeId,
        tokenHash,
        status: 'active',
        issuedAt: now
      })
      return {
        nodeId,
        token,
        issuedAt: now.toISOString()
      }
    },
    async hasActiveNodeCredential(nodeId: string) {
      const [credential] = await db
        .select()
        .from(nodeCredentials)
        .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
        .limit(1)
      return Boolean(credential)
    },
    async validateNodeCredential(nodeId: string, token: string) {
      const [credential] = await db
        .select()
        .from(nodeCredentials)
        .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
        .limit(1)
      if (!credential) return false
      const tokenHash = await hashNodeToken(token)
      if (tokenHash !== credential.tokenHash) return false
      // lastUsedAt 用于后续安全审计和运行态诊断，不参与授权结论本身。
      await db
        .update(nodeCredentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(nodeCredentials.id, credential.id))
      return true
    },
    async listNodes() {
      const rows = await db.select().from(nodes)
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind as MNode['kind'],
        name: row.name,
        mode: row.mode as MNode['mode'],
        status: row.status as MNode['status'],
        reachability: row.reachability as MNode['reachability'],
        ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
        ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
        capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
        createdAt: row.createdAt.toISOString()
      }))
    },
    async getNode(id: string) {
      const rows = await db.select().from(nodes).where(eq(nodes.id, id)).limit(1)
      const row = rows[0]
      return row
        ? {
            id: row.id,
            kind: row.kind as MNode['kind'],
            name: row.name,
            mode: row.mode as MNode['mode'],
            status: row.status as MNode['status'],
            reachability: row.reachability as MNode['reachability'],
            ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
            ...(row.agentVersion ? { agentVersion: row.agentVersion } : {}),
            capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
            createdAt: row.createdAt.toISOString()
          }
        : null
    },
    async registerService(input: unknown) {
      const definition = input as { id?: string; version?: string; domain?: string; kind?: string }
      const now = new Date()
      await db.insert(serviceDefinitions).values({
        id: definition.id ?? crypto.randomUUID(),
        version: definition.version ?? '0.1.0',
        domain: definition.domain ?? 'unknown',
        kind: definition.kind ?? 'service',
        definition: input,
        createdAt: now,
        updatedAt: now
      })
      return input
    },
    async listServices() {
      return db.select().from(serviceDefinitions)
    }
  }
}
