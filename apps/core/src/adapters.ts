import { eq } from 'drizzle-orm'
import { err, ok } from '../../../packages/common/src/result.ts'
import type {
  ActorId,
  AssignTaskRequest,
  CreateNetworkRequest,
  AuditLog,
  FullLog,
  MNode,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  MTask,
  PolicyDecision,
  RegisterNodeRequest,
  TimelineLog
} from '../../../packages/contracts/src/index.ts'
import { createDb, type MeristemDb } from '../../../packages/db/src/client.ts'
import { nodes, serviceDefinitions, tasks } from '../../../packages/db/src/schema.ts'
import { createNatsRpcClient, subjects, type RpcClient } from '../../../packages/nats-rpc/src/index.ts'
import { extractBearerToken, verifyLocalToken } from '../../../packages/auth/src/index.ts'
import type { CoreDeps, CoreStorage } from './types.ts'

type ServiceResponse<T> = { ok: true; decision?: PolicyDecision; entry?: T; entries?: T[]; eventId?: string }

function requiredSecret(): string {
  const secret = process.env.MERISTEM_JWT_SECRET
  if (!secret) throw new Error('MERISTEM_JWT_SECRET is required')
  return secret
}

export function createJwtAuthPort(secret = requiredSecret()) {
  return {
    async verify(token: string) {
      return verifyLocalToken({ token, secret })
    }
  }
}

export function createRpcPolicyPort(rpc: RpcClient) {
  return {
    async authorize(input: Parameters<CoreDeps['policy']['authorize']>[0]) {
      try {
        const response = await rpc.request<typeof input, { ok: true; decision: PolicyDecision }>(
          subjects.policyAuthorize,
          input
        )
        return ok(response.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    },
    async getDecision(id: string) {
      try {
        const response = await rpc.request<{ id: string }, { ok: true; decision: PolicyDecision | null }>(
          subjects.policyDecisionGet,
          { id }
        )
        return ok(response.decision)
      } catch {
        return err({ code: 'policy.unavailable', message: 'M-Policy unavailable' })
      }
    }
  }
}

export function createRpcLogPort(rpc: RpcClient) {
  return {
    async writeTimeline(input: Omit<TimelineLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<TimelineLog>>(subjects.timelineWrite, input)
        return response.entry ? ok(response.entry) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeFull(input: Omit<FullLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<FullLog>>(subjects.fullWrite, input)
        return response.entry ? ok(response.entry) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async writeAudit(input: Omit<AuditLog, 'id' | 'timestamp'>) {
      try {
        const response = await rpc.request<typeof input, ServiceResponse<AuditLog>>(subjects.auditWrite, input)
        return response.entry ? ok(response.entry) : err({ code: 'audit.invalid_response', message: 'invalid audit response' })
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    },
    async listTimeline(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<TimelineLog>>(
          subjects.timelineList,
          limit === undefined ? {} : { limit }
        )
        return response.entries ? ok(response.entries) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listFull(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<FullLog>>(
          subjects.fullList,
          limit === undefined ? {} : { limit }
        )
        return response.entries ? ok(response.entries) : err({ code: 'log.invalid_response', message: 'invalid log response' })
      } catch {
        return err({ code: 'log.unavailable', message: 'M-Log unavailable' })
      }
    },
    async listAudit(limit?: number) {
      try {
        const response = await rpc.request<{ limit?: number }, ServiceResponse<AuditLog>>(
          subjects.auditList,
          limit === undefined ? {} : { limit }
        )
        return response.entries ? ok(response.entries) : err({ code: 'audit.invalid_response', message: 'invalid audit response' })
      } catch {
        return err({ code: 'audit.unavailable', message: 'Audit Log unavailable' })
      }
    }
  }
}

export function createRpcEventPort(rpc: RpcClient) {
  return {
    async publish(subject: string, event: Parameters<CoreDeps['events']['publish']>[1]) {
      try {
        const response = await rpc.request<{ subject: string; event: typeof event }, { ok: boolean; eventId?: string }>(
          subjects.eventPublish,
          { subject, event }
        )
        return response.ok && response.eventId
          ? ok({ eventId: response.eventId })
          : err({ code: 'eventbus.rejected', message: 'event rejected by M-EventBus' })
      } catch {
        return err({ code: 'eventbus.unavailable', message: 'M-EventBus unavailable' })
      }
    }
  }
}

type MNetServiceResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

export function createRpcMNetPort(rpc: RpcClient) {
  return {
    async createNetwork(input: CreateNetworkRequest) {
      try {
        const response = await rpc.request<CreateNetworkRequest, MNetServiceResponse<MNetwork>>(subjects.networkCreate, input)
        if (!response.ok) return err(response.error)
        return ok(response.value)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    },
    async listNetworks() {
      try {
        const response = await rpc.request<Record<string, never>, MNetServiceResponse<NetworkSummary[]>>(subjects.networkList, {})
        if (!response.ok) return err(response.error)
        return ok(response.value)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    },
    async joinNetwork(input: { networkId: string; nodeId: string }) {
      try {
        const response = await rpc.request<typeof input, MNetServiceResponse<MNetworkMember>>(subjects.networkJoin, input)
        if (!response.ok) return err(response.error)
        return ok(response.value)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    },
    async listNetworkMembers(networkId: string) {
      try {
        const response = await rpc.request<{ networkId: string }, MNetServiceResponse<MNetworkMember[]>>(
          subjects.networkMembersList,
          { networkId }
        )
        if (!response.ok) return err(response.error)
        return ok(response.value)
      } catch {
        return err({ code: 'mnet.unavailable', message: 'M-Net unavailable' })
      }
    }
  }
}

export function createDbStorage(db: MeristemDb): CoreStorage {
  return {
    async readiness() {
      return { postgres: 'ready', nats: 'ready' }
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
      await db.insert(nodes).values({
        id,
        kind: input.kind,
        name: input.name,
        status: 'healthy',
        capabilities: input.capabilities ?? [],
        scope: input.kind === 'leaf' ? ['restricted-api', 'restricted-interconnect'] : [],
        createdAt: now,
        updatedAt: now
      })
      return {
        id,
        kind: input.kind,
        name: input.name,
        status: 'healthy',
        capabilities: input.capabilities ?? [],
        createdAt: now.toISOString()
      }
    },
    async listNodes() {
      const rows = await db.select().from(nodes)
      return rows.map((row) => ({
        id: row.id,
        kind: row.kind as MNode['kind'],
        name: row.name,
        status: row.status as MNode['status'],
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
            status: row.status as MNode['status'],
            capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
            createdAt: row.createdAt.toISOString()
          }
        : null
    },
    async assignTask(input: AssignTaskRequest) {
      const nodeRows = await db.select().from(nodes).where(eq(nodes.id, input.leafNodeId)).limit(1)
      if (nodeRows[0]?.kind !== 'leaf') throw new Error('target must be an existing Leaf node')
      const now = new Date()
      const id = crypto.randomUUID()
      await db.insert(tasks).values({
        id,
        leafNodeId: input.leafNodeId,
        type: input.type,
        status: 'completed',
        createdAt: now,
        completedAt: now
      })
      return {
        id,
        leafNodeId: input.leafNodeId,
        type: input.type,
        status: 'completed',
        createdAt: now.toISOString(),
        completedAt: now.toISOString()
      }
    },
    async getTask(id: string) {
      const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1)
      const row = rows[0]
      if (!row) return null
      const task: MTask = {
        id: row.id,
        leafNodeId: row.leafNodeId,
        type: 'noop',
        status: row.status as MTask['status'],
        createdAt: row.createdAt.toISOString()
      }
      if (row.completedAt) task.completedAt = row.completedAt.toISOString()
      return task
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

export async function createProductionDeps(): Promise<CoreDeps & { close(): Promise<void> }> {
  const { db, client } = createDb()
  const rpc = await createNatsRpcClient()
  return {
    startedAt: Date.now(),
    version: '0.1.0',
    auth: createJwtAuthPort(),
    policy: createRpcPolicyPort(rpc),
    log: createRpcLogPort(rpc),
    events: createRpcEventPort(rpc),
    mNet: createRpcMNetPort(rpc),
    storage: createDbStorage(db),
    async close() {
      await rpc.close()
      await client.end()
    }
  }
}

export function bearerTokenFromRequest(request: Request): string | null {
  return extractBearerToken(request.headers.get('authorization') ?? undefined)
}
