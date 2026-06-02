import { and, desc, eq } from 'drizzle-orm'
import type {
  ActorId,
  CreateNodeTicketRequest,
  CoreDependencies,
  MNode,
  RegisterNodeRequest
} from '../../../packages/contracts/src/index.ts'
import { type MeristemDb } from '../../../packages/db/src/client.ts'
import {
  actorTokenRevocations,
  actorTokens,
  actors,
  configApplyAcks,
  configRecords,
  configTransitions,
  configVersions,
  nodeCredentials,
  nodeJoinTickets,
  nodes,
  secretRefTransitions,
  secretRefVersions,
  secretRefs,
  serviceDefinitions,
  tasks
} from '../../../packages/db/src/schema.ts'
import { hashNodeToken, mintNodeToken } from '../../../packages/auth/src/index.ts'
import {
  type CreateConfigInput,
  type CreateConfigVersionInput,
  type CreateIdentityTokenInput,
  type CreateSecretRefInput,
  type CreateSecretRefVersionInput,
  type ConfigAckRecord,
  type ConfigRecord,
  type ConfigVersionRecord,
  type IdentityActorRecord,
  type IdentityTokenRecord,
  type IdentityTokenRevocationRecord,
  type RecordConfigAckInput,
  type RecordConfigTransitionInput,
  type RecordSecretRefTransitionInput,
  type RevokeIdentityTokenInput,
  type SecretRefRecord,
  type SecretRefVersionRecord,
  type UpdateConfigStatusExtra,
  mapActorRow,
  mapConfigAckRow,
  mapConfigRow,
  mapConfigVersionRow,
  mapRevocationRow,
  mapSecretRefRow,
  mapSecretRefVersionRow,
  mapTokenRow
} from './storage-adapter-records.ts'
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
      const [row] = await db.select().from(actorTokenRevocations).where(eq(actorTokenRevocations.jti, jti)).limit(1)
      return row ? mapRevocationRow(row) : null
    }
  }
}

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
      await db.update(secretRefs).set({ status, updatedAt: new Date() }).where(eq(secretRefs.id, id))
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
    async getAck(configId: string, targetService: string): Promise<ConfigAckRecord | null> {
      const [row] = await db
        .select()
        .from(configApplyAcks)
        .where(and(eq(configApplyAcks.configId, configId), eq(configApplyAcks.targetService, targetService)))
        .limit(1)
      return row ? mapConfigAckRow(row) : null
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
