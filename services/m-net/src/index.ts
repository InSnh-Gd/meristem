import { edenTreaty } from '@elysiajs/eden'
import type { ServerWebSocket } from 'bun'
import { and, eq } from 'drizzle-orm'
import { mintNodeToken, hashNodeToken } from '../../../packages/auth/src/index.ts'
import { createDb } from '../../../packages/db/src/client.ts'
import { networkMemberships, networks, nodeCredentials, nodeJoinTickets, nodes } from '../../../packages/db/src/schema.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import {
  createInternalFetcher,
  fetchReadyState,
  internalServicePorts,
  serveHttpApp,
  serviceUrl
} from '../../../packages/internal-http/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import type {
  CreateNetworkRequest,
  JoinRedeemMessage,
  MNetSessionClientMessage,
  MNetSessionServerMessage,
  MNetwork,
  MNetworkMember,
  MNode,
  NetworkSummary,
  NodeAgentTaskExecuteResponse,
  NodeKind,
  NodeStatus,
  SessionHeartbeatMessage,
  SessionLogForwardMessage,
  SessionResumeMessage,
  SessionTaskResultMessage
} from '../../../packages/contracts/src/index.ts'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import type { EventBusApp } from '../../m-eventbus/src/app.ts'
import type { LogApp } from '../../m-log/src/app.ts'
import { createMNetApp, type MNetServiceError, type MNetServiceResult } from './app.ts'
import { createInMemoryProfileStore } from './profile-store.ts'
import { createInMemorySuspendedOperationStore } from './suspended-operations.ts'
import {
  authorizeSessionMessage,
  deriveHeartbeatTransition,
  joinTicketRedeemability,
  shouldTransitionOfflineOnDisconnect,
  shouldTransitionOffline,
  type RuntimeNodeSnapshot
} from './runtime.ts'

type JoinSessionData = {
  nodeId?: string
  sessionId?: string
}

type PendingTask = {
  nodeId: string
  correlationId: string
  timeout: ReturnType<typeof setTimeout>
  resolve(value: NodeAgentTaskExecuteResponse): void
  reject(error: MNetServiceError): void
}

const { db, client } = createDb()
initTelemetry('m-net')

const eventBus = edenTreaty<EventBusApp>(serviceUrl('m-eventbus'), {
  fetcher: createInternalFetcher()
})
const logService = edenTreaty<LogApp>(serviceUrl('m-log'), {
  fetcher: createInternalFetcher()
})

// Phase 13: 内存存储实例，待 Phase 14 替换为 PostgreSQL adapter
const profileStore = createInMemoryProfileStore()
const suspendedOps = createInMemorySuspendedOperationStore()

/**
 * Phase 13 审批回调客户端：调用 M-Policy 内部端点创建审批。
 * 降级模式返回成功（内存模式），生产环境通过 internal HTTP 调用 M-Policy。
 */
const approvalClient = {
  async create(input: {
    policyDecisionId: string; originService: string; operationId: string;
    requestedBy: string; requiredAction: string; quorumRequired: number; expiresAt: string
  }): Promise<{ ok: true; value: { approvalId: string } } | { ok: false; error: { code: string; message: string } }> {
    try {
      const response = await createInternalFetcher()(`${serviceUrl('m-policy')}/internal/v0/policy/approvals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input)
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
        return { ok: false, error: { code: body.error?.code ?? 'approval.create_failed', message: body.error?.message ?? 'failed to create approval' } }
      }
      const data = await response.json() as { approval: { id: string } }
      return { ok: true, value: { approvalId: data.approval.id } }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, error: { code: 'approval.create_failed', message } }
    }
  }
}

const activeSessions = new Map<string, ServerWebSocket<JoinSessionData>>()
const activeSessionIds = new Map<string, string>()
const pendingTasks = new Map<string, PendingTask>()

function ok<T>(value: T): MNetServiceResult<T> {
  return { ok: true, value }
}

/**
 * 运行态错误统一保持 `{ code, message }` 形状，便于 internal HTTP、WebSocket 和日志复用。
 */
function err(code: string, message: string): MNetServiceResult<never> {
  return { ok: false, error: { code, message } }
}

function asNodeKind(value: string): NodeKind | null {
  return value === 'stem' || value === 'leaf' ? value : null
}

function membershipModeFor(kind: NodeKind): MNetworkMember['membershipMode'] {
  return kind === 'stem' ? 'full' : 'restricted'
}

function heartbeatTimeoutMs(): number {
  const value = Number(process.env.MERISTEM_AGENT_HEARTBEAT_TIMEOUT_MS ?? '15000')
  return Number.isFinite(value) && value > 0 ? value : 15000
}

/**
 * task execute 超时收敛到配置项，确保 Core 等待 agent 结果的窗口可预测且可审计。
 */
function taskTimeoutMs(): number {
  const value = Number(process.env.MERISTEM_AGENT_TASK_TIMEOUT_MS ?? '5000')
  return Number.isFinite(value) && value > 0 ? value : 5000
}

function joinIngressPort(): number {
  const value = Number(process.env.MERISTEM_JOIN_INGRESS_PORT ?? '8443')
  return Number.isFinite(value) && value > 0 ? value : 8443
}

function joinTlsCertFile(): string {
  return process.env.MERISTEM_JOIN_TLS_CERT_FILE ?? '.local/certs/join-ingress-cert.pem'
}

function joinTlsKeyFile(): string {
  return process.env.MERISTEM_JOIN_TLS_KEY_FILE ?? '.local/certs/join-ingress-key.pem'
}

async function joinTlsConfig(): Promise<{ cert: string; key: string }> {
  const [cert, key] = await Promise.all([
    Bun.file(joinTlsCertFile()).text(),
    Bun.file(joinTlsKeyFile()).text()
  ])
  return { cert, key }
}

function mapNetwork(row: typeof networks.$inferSelect): MNetwork {
  return {
    id: row.id,
    name: row.name,
    profileVersion: row.profileVersion,
    status: 'active',
    createdAt: row.createdAt.toISOString()
  }
}

function asRuntimeNode(row: typeof nodes.$inferSelect): RuntimeNodeSnapshot {
  return {
    id: row.id,
    mode: row.mode as RuntimeNodeSnapshot['mode'],
    status: row.status as RuntimeNodeSnapshot['status'],
    reachability: row.reachability as RuntimeNodeSnapshot['reachability'],
    ...(row.lastSeenAt ? { lastSeenAt: row.lastSeenAt.toISOString() } : {}),
    ...(row.agentVersion ? { agentVersion: row.agentVersion } : {})
  }
}

function mapNode(row: typeof nodes.$inferSelect): MNode {
  return {
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
}

/**
 * 从 WebSocket 原始帧解出版本化 session 消息；解析失败时调用方必须回 error frame，而不是静默忽略。
 */
function parseClientMessage(raw: string): MNetSessionClientMessage | null {
  try {
    const parsed = JSON.parse(raw) as MNetSessionClientMessage
    return typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'string' ? parsed : null
  } catch {
    return null
  }
}

/**
 * Bun WebSocket message 可能是 string、ArrayBuffer 或 Blob，这里统一归一化成 JSON 文本。
 */
function messageText(message: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof message === 'string') return message
  return new TextDecoder().decode(
    message instanceof ArrayBuffer
      ? new Uint8Array(message)
      : new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
  )
}

/**
 * 所有服务端帧都从单一点发送，避免 join/session/task 三类消息在不同分支里漂移字段形状。
 */
function sendServerMessage(ws: ServerWebSocket<JoinSessionData>, message: MNetSessionServerMessage): void {
  ws.send(JSON.stringify(message))
}

function sessionNodeId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.nodeId === 'string' ? ws.data.nodeId : null
}

/**
 * 只有 activeSessions 里仍绑定到该 ws 的连接才算当前有效 session。
 */
function isActiveSession(ws: ServerWebSocket<JoinSessionData>): boolean {
  const nodeId = sessionNodeId(ws)
  return nodeId !== null && activeSessions.get(nodeId) === ws
}

function sessionId(ws: ServerWebSocket<JoinSessionData>): string | null {
  return typeof ws.data.sessionId === 'string' ? ws.data.sessionId : null
}

function rejectPendingTasksForNode(nodeId: string, error: MNetServiceError): void {
  for (const [taskId, pending] of pendingTasks.entries()) {
    if (pending.nodeId !== nodeId) continue
    clearTimeout(pending.timeout)
    pendingTasks.delete(taskId)
    void writeFull('warn', `failed noop task ${taskId}`, pending.correlationId, undefined, {
      nodeId,
      taskId,
      reason: error.code,
      channel: 'session.task.result'
    })
    pending.reject(error)
  }
}

/**
 * 每个 agent 节点同一时刻只保留一个活动 session；后来的连接会顶掉旧连接，避免任务被双写。
 */
function bindSession(ws: ServerWebSocket<JoinSessionData>, nodeId: string): string {
  const previous = activeSessions.get(nodeId)
  const nextSessionId = crypto.randomUUID()
  ws.data.nodeId = nodeId
  ws.data.sessionId = nextSessionId
  activeSessions.set(nodeId, ws)
  activeSessionIds.set(nodeId, nextSessionId)
  if (previous && previous !== ws) previous.close(4001, 'superseded')
  return nextSessionId
}

/**
 * 事件发布统一经由 M-EventBus 的 internal HTTP 面，M-Net 自身不再直接占用 NATS 作为同步业务边界。
 */
async function publishEvent(subject: string, type: string, payload: unknown, correlationId?: string, traceId?: string): Promise<void> {
  const event = createEventEnvelope({
    type,
    source: 'm-net',
    payload,
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {})
  })
  const response = await eventBus.internal.v0.publish.post({ subject, event })
  if (response.error || !response.data) throw new Error(`failed to publish ${subject}`)
}

/**
 * M-Net 的时间线写入集中在这里，确保 join、resume、offline 回收等运行态事件有稳定日志事实。
 */
async function writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void> {
  const response = await logService.internal.v0.timeline.post({
    summary,
    ...(subject ? { subject } : {}),
    ...(correlationId ? { correlationId } : {})
  })
  if (response.error || !response.data) throw new Error('failed to write timeline entry')
}

/**
 * Full Log 用于记录 join/session/task 的细粒度运行信息，不把这些边界诊断塞进 Timeline 或 Audit。
 */
async function writeFull(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  correlationId?: string,
  traceId?: string,
  payload?: unknown
): Promise<void> {
  const response = await logService.internal.v0.full.post({
    level,
    source: 'm-net',
    message,
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(payload === undefined ? {} : { payload })
  })
  if (response.error || !response.data) throw new Error('failed to write full log entry')
}

/**
 * 安全异常如无效运行 token 必须进入 Audit Log，保持“节点身份异常”这一事实可追溯。
 */
async function writeAudit(resource: string, action: string, correlationId?: string, traceId?: string, payload?: unknown): Promise<void> {
  const response = await logService.internal.v0.audit.post({
    actor: 'system',
    action,
    resource,
    result: 'deny',
    ...(correlationId ? { correlationId } : {}),
    ...(traceId ? { traceId } : {}),
    ...(payload === undefined ? {} : { payload })
  })
  if (response.error || !response.data) throw new Error('failed to write audit entry')
}

const profileEvents = {
  async publish(subject: string, type: string, payload: unknown, correlationId?: string): Promise<void> {
    const event = createEventEnvelope({
      type,
      source: 'm-net',
      payload,
      ...(correlationId ? { correlationId } : {})
    })
    const response = await eventBus.internal.v0.publish.post({ subject, event })
    if (response.error || !response.data) throw new Error(`failed to publish ${subject}`)
  }
}

const profileLog = {
  async writeTimeline(summary: string, subject?: string, correlationId?: string): Promise<void> {
    const response = await logService.internal.v0.timeline.post({
      summary,
      ...(subject ? { subject } : {}),
      ...(correlationId ? { correlationId } : {})
    })
    if (response.error || !response.data) throw new Error('failed to write timeline')
  },
  async writeFull(level: string, message: string, correlationId?: string, payload?: unknown): Promise<void> {
    const response = await logService.internal.v0.full.post({
      level: level as 'debug' | 'info' | 'warn' | 'error',
      source: 'm-net',
      message,
      ...(correlationId ? { correlationId } : {}),
      ...(payload === undefined ? {} : { payload })
    })
    if (response.error || !response.data) throw new Error('failed to write full log')
  },
  async writeAudit(actor: ActorId, action: string, resource: string, result: string, correlationId?: string, payload?: unknown): Promise<void> {
    const response = await logService.internal.v0.audit.post({
      actor,
      action,
      resource,
      result: result as 'success' | 'failure' | 'deny' | 'pending' | 'allow' | 'canceled',
      ...(correlationId ? { correlationId } : {}),
      ...(payload === undefined ? {} : { payload })
    })
    if (response.error || !response.data) throw new Error('failed to write audit')
  }
}

/**
 * 运行 token 校验只依赖 PostgreSQL 中的 active 哈希记录，不信任节点自报身份或活动 session 状态本身。
 */
async function validateNodeCredential(nodeId: string, token: string): Promise<boolean> {
  const [credential] = await db
    .select()
    .from(nodeCredentials)
    .where(and(eq(nodeCredentials.nodeId, nodeId), eq(nodeCredentials.status, 'active')))
    .limit(1)
  if (!credential) return false
  const tokenHash = await hashNodeToken(token)
  if (tokenHash !== credential.tokenHash) return false
  await db
    .update(nodeCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(nodeCredentials.id, credential.id))
  return true
}

/**
 * Join Ticket 兑换成功后，M-Net 负责为该 agent 签发运行 token；
 * token 明文只在这里返回一次，数据库只保留哈希和生命周期元数据。
 */
type CredentialStore = Pick<typeof db, 'insert' | 'update'>

async function issueRuntimeCredential(store: CredentialStore, nodeId: string): Promise<{ token: string; issuedAt: string }> {
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

/**
 * Join Ticket 兑换是公网 agent 首次接入的唯一入口：
 * 票据校验、节点创建、运行 token 签发和票据失效都必须在同一条边界里完成。
 */
async function redeemJoinTicket(message: JoinRedeemMessage): Promise<MNetServiceResult<{ node: MNode; runtimeToken: string; issuedAt: string }>> {
  const ticketHash = await hashNodeToken(message.ticket)

  const redeemed = await db.transaction(async (tx) => {
    const [ticketRow] = await tx
      .select()
      .from(nodeJoinTickets)
      .where(eq(nodeJoinTickets.ticketHash, ticketHash))
      .limit(1)

    if (!ticketRow) return err('node.join_ticket_invalid', 'join ticket is invalid')

    const redeemability = joinTicketRedeemability({
      status: ticketRow.status as typeof ticketRow.status & ('active' | 'redeemed' | 'expired' | 'revoked'),
      expiresAt: ticketRow.expiresAt.toISOString()
    }, new Date())

    if (redeemability === 'expired') {
      await tx.update(nodeJoinTickets).set({ status: 'expired' }).where(eq(nodeJoinTickets.id, ticketRow.id))
      return err('node.join_ticket_expired', 'join ticket is expired')
    }
    if (redeemability === 'redeemed') return err('node.join_ticket_redeemed', 'join ticket has already been redeemed')
    if (redeemability === 'revoked') return err('node.join_ticket_revoked', 'join ticket has been revoked')

    const now = new Date()
    const nodeId = crypto.randomUUID()
    // 先把 ticket 认领成 redeemed，再创建 node / credential，避免并发兑换在 select 之后分叉出两个成功分支。
    // redeemed_node_id 带外键，必须等 node 真正落库后再回填，不能在 node 尚不存在时提前写入。
    await tx
      .update(nodeJoinTickets)
      .set({
        status: 'redeemed',
        redeemedAt: now
      })
      .where(and(eq(nodeJoinTickets.id, ticketRow.id), eq(nodeJoinTickets.status, 'active')))

    const [latestTicket] = await tx.select().from(nodeJoinTickets).where(eq(nodeJoinTickets.id, ticketRow.id)).limit(1)
    if (!latestTicket || latestTicket.status !== 'redeemed' || latestTicket.redeemedAt?.getTime() !== now.getTime()) {
      const latestStatus = latestTicket?.status as typeof ticketRow.status | undefined
      if (latestStatus === 'expired') return err('node.join_ticket_expired', 'join ticket is expired')
      if (latestStatus === 'revoked') return err('node.join_ticket_revoked', 'join ticket has been revoked')
      if (latestStatus === 'redeemed') return err('node.join_ticket_redeemed', 'join ticket has already been redeemed')
      return err('node.join_ticket_invalid', 'join ticket is invalid')
    }

    await tx.insert(nodes).values({
      id: nodeId,
      kind: ticketRow.kind,
      name: ticketRow.name,
      mode: 'agent',
      status: 'joining',
      reachability: 'unknown',
      capabilities: Array.isArray(ticketRow.capabilities) ? ticketRow.capabilities.map(String) : [],
      scope: ticketRow.kind === 'leaf' ? ['restricted-api', 'restricted-interconnect'] : [],
      createdAt: now,
      updatedAt: now
    })
    const [nodeRow] = await tx.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
    if (!nodeRow) return err('node.unavailable', 'failed to create node')

    await tx
      .update(nodeJoinTickets)
      .set({ redeemedNodeId: nodeId })
      .where(eq(nodeJoinTickets.id, ticketRow.id))

    const runtimeCredential = await issueRuntimeCredential(tx, nodeId)

    return ok({
      node: mapNode(nodeRow),
      runtimeToken: runtimeCredential.token,
      issuedAt: runtimeCredential.issuedAt
    })
  })

  if (!redeemed.ok) return redeemed

  await publishEvent(
    'node.registration.accepted.v0',
    'node.registration.accepted',
    { nodeId: redeemed.value.node.id, kind: redeemed.value.node.kind, mode: 'agent' }
  )
  await writeTimeline(`redeemed join ticket for node ${redeemed.value.node.name}`, redeemed.value.node.id)

  return redeemed
}

/**
 * resume 只恢复已存在 agent 节点的 session，不会重放 Join Ticket，也不会重新创建节点记录。
 */
async function resumeSession(message: SessionResumeMessage): Promise<MNetServiceResult<MNode>> {
  const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, message.nodeId)).limit(1)
  if (!nodeRow || nodeRow.mode !== 'agent') return err('node.not_found', 'node not found')
  const validCredential = await validateNodeCredential(message.nodeId, message.token)
  if (!validCredential) {
    await writeAudit(`node:${message.nodeId}`, 'node:resume-token-invalid', undefined, undefined, { channel: 'session.resume' })
    return err('nodeagent.invalid_token', 'node runtime token is invalid')
  }
  return ok(mapNode(nodeRow))
}

/**
 * heartbeat 是 agent 在线状态的唯一权威驱动：
 * session 存活不等于节点可达，节点状态必须由心跳和超时规则共同决定。
 */
async function applyHeartbeat(nodeId: string, heartbeat: SessionHeartbeatMessage): Promise<MNetServiceResult<void>> {
  const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!nodeRow || nodeRow.mode !== 'agent') return err('node.not_found', 'node not found')

  const transition = deriveHeartbeatTransition(asRuntimeNode(nodeRow), heartbeat)
  await db
    .update(nodes)
    .set({
      status: transition.nextStatus,
      reachability: transition.nextReachability,
      lastSeenAt: new Date(transition.nextLastSeenAt),
      agentVersion: transition.nextAgentVersion,
      updatedAt: new Date()
    })
    .where(eq(nodes.id, nodeId))

  if (transition.reachabilityChanged) {
    await publishEvent(
      'mnet.reachability.changed.v0',
      'mnet.reachability.changed',
      {
        nodeId,
        previousReachability: nodeRow.reachability,
        nextReachability: transition.nextReachability
      }
    )
    await writeTimeline(`node became reachable ${nodeId}`, nodeId)
  }

  if (transition.statusChanged) {
    await publishEvent(
      'node.status.changed.v0',
      'node.status.changed',
      {
        nodeId,
        previousStatus: nodeRow.status,
        nextStatus: transition.nextStatus,
        reason: 'heartbeat_reported'
      }
    )
  }

  return ok(undefined)
}

/**
 * agent 通过 session.forward 送来的日志会在 M-Net 侧补上节点身份和通道来源，再统一落到 M-Log。
 */
async function forwardLog(nodeId: string, message: SessionLogForwardMessage): Promise<void> {
  await writeFull(
    message.level,
    message.message,
    message.correlationId,
    message.traceId,
    {
      nodeId,
      channel: 'session.log.forward',
      timestamp: message.timestamp,
      ...(message.payload === undefined ? {} : { payload: message.payload })
    }
  )
}

/**
 * create/list/join/listMembers 继续承载 Phase 6 的逻辑网络模型，
 * 只是同步调用边界从 NATS RPC 切换到了 internal HTTP。
 */
async function createNetwork(input: CreateNetworkRequest): Promise<MNetServiceResult<MNetwork>> {
  const existing = await db.select().from(networks).where(eq(networks.name, input.name)).limit(1)
  if (existing[0]) return err('network.conflict', 'network name already exists')

  const now = new Date()
  const network: typeof networks.$inferInsert = {
    id: crypto.randomUUID(),
    name: input.name,
    profileVersion: 'm-net-default@0.1.0',
    status: 'active',
    createdAt: now,
    updatedAt: now
  }

  await db.insert(networks).values(network)
  // Phase 13: seed profile state for new network
  await profileStore.setNetworkState(network.id, {
    profileVersion: network.profileVersion,
    status: 'disabled'
  })
  return ok(mapNetwork(network))
}

async function listNetworks(): Promise<MNetServiceResult<NetworkSummary[]>> {
  const [networkRows, membershipRows] = await Promise.all([
    db.select().from(networks),
    db.select().from(networkMemberships)
  ])

  return ok(networkRows.map((network) => ({
    ...mapNetwork(network),
    memberCount: membershipRows.filter((membership) => membership.networkId === network.id).length
  })))
}

async function joinNetwork(input: { networkId: string; nodeId: string }): Promise<MNetServiceResult<MNetworkMember>> {
  const [networkRow] = await db.select().from(networks).where(eq(networks.id, input.networkId)).limit(1)
  if (!networkRow) return err('network.not_found', 'network not found')

  const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, input.nodeId)).limit(1)
  if (!nodeRow) return err('node.not_found', 'node not found')

  const nodeKind = asNodeKind(nodeRow.kind)
  if (!nodeKind) return err('node.invalid_kind', 'node kind cannot join logical networks')
  if ((nodeRow.status as NodeStatus) !== 'healthy') return err('node.invalid_status', 'node must be healthy')

  const [existingMembership] = await db
    .select()
    .from(networkMemberships)
    .where(and(eq(networkMemberships.networkId, input.networkId), eq(networkMemberships.nodeId, input.nodeId)))
    .limit(1)

  if (existingMembership) {
    return ok({
      networkId: existingMembership.networkId,
      nodeId: existingMembership.nodeId,
      nodeKind,
      membershipMode: existingMembership.membershipMode as MNetworkMember['membershipMode'],
      status: existingMembership.status as MNetworkMember['status'],
      joinedAt: existingMembership.joinedAt.toISOString()
    })
  }

  if (nodeKind === 'leaf') {
    const stemMembers = await db
      .select({ nodeKind: nodes.kind })
      .from(networkMemberships)
      .innerJoin(nodes, eq(networkMemberships.nodeId, nodes.id))
      .where(eq(networkMemberships.networkId, input.networkId))
    const hasStemMember = stemMembers.some((member) => member.nodeKind === 'stem')
    if (!hasStemMember) return err('network.stem_required', 'leaf nodes require a stem member')
  }

  const now = new Date()
  await db.insert(networkMemberships).values({
    networkId: input.networkId,
    nodeId: input.nodeId,
    membershipMode: membershipModeFor(nodeKind),
    status: 'joined',
    joinedAt: now,
    updatedAt: now
  })

  return ok({
    networkId: input.networkId,
    nodeId: input.nodeId,
    nodeKind,
    membershipMode: membershipModeFor(nodeKind),
    status: 'joined',
    joinedAt: now.toISOString()
  })
}

async function listMembers(input: { networkId: string }): Promise<MNetServiceResult<MNetworkMember[]>> {
  const [networkRow] = await db.select().from(networks).where(eq(networks.id, input.networkId)).limit(1)
  if (!networkRow) return err('network.not_found', 'network not found')

  const rows = await db
    .select({
      networkId: networkMemberships.networkId,
      nodeId: networkMemberships.nodeId,
      membershipMode: networkMemberships.membershipMode,
      status: networkMemberships.status,
      joinedAt: networkMemberships.joinedAt,
      nodeKind: nodes.kind
    })
    .from(networkMemberships)
    .innerJoin(nodes, eq(networkMemberships.nodeId, nodes.id))
    .where(eq(networkMemberships.networkId, input.networkId))

  return ok(rows.flatMap((row) => {
    const nodeKind = asNodeKind(row.nodeKind)
    if (!nodeKind) return []
    return [{
      networkId: row.networkId,
      nodeId: row.nodeId,
      nodeKind,
      membershipMode: row.membershipMode as MNetworkMember['membershipMode'],
      status: row.status as MNetworkMember['status'],
      joinedAt: row.joinedAt.toISOString()
    }]
  }))
}

async function executeNoop(input: { nodeId: string; taskId: string; correlationId: string }): Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>> {
  const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, input.nodeId)).limit(1)
  if (!nodeRow) return err('node.not_found', 'node not found')
  if (nodeRow.mode !== 'agent') return err('node.invalid_kind', 'target is not an agent node')
  if (nodeRow.reachability !== 'reachable' || (nodeRow.status !== 'healthy' && nodeRow.status !== 'degraded')) {
    return err('node.unreachable', 'node is unreachable')
  }

  const session = activeSessions.get(input.nodeId)
  if (!session) return err('node.unreachable', 'node is unreachable')

  return await new Promise<MNetServiceResult<NodeAgentTaskExecuteResponse>>((resolve) => {
    const timeout = setTimeout(() => {
      pendingTasks.delete(input.taskId)
      void writeFull('warn', `timed out waiting for noop task ${input.taskId}`, input.correlationId, undefined, {
        nodeId: input.nodeId,
        taskId: input.taskId,
        channel: 'session.task.execute'
      })
      resolve(err('nodeagent.unavailable', 'node agent did not return a task result in time'))
    }, taskTimeoutMs())

    pendingTasks.set(input.taskId, {
      nodeId: input.nodeId,
      correlationId: input.correlationId,
      timeout,
      resolve(value) {
        clearTimeout(timeout)
        pendingTasks.delete(input.taskId)
        resolve(ok(value))
      },
      reject(error) {
        clearTimeout(timeout)
        pendingTasks.delete(input.taskId)
        resolve(err(error.code, error.message))
      }
    })

    void writeFull('info', `dispatched noop task ${input.taskId}`, input.correlationId, undefined, {
      nodeId: input.nodeId,
      taskId: input.taskId,
      channel: 'session.task.execute'
    })
    sendServerMessage(session, {
      type: 'task.execute',
      nodeId: input.nodeId,
      taskId: input.taskId,
      taskType: 'noop',
      correlationId: input.correlationId
    })
  })
}

/**
 * offline 迁移统一走一条路径，保证 heartbeat timeout 与 socket disconnect
 * 在数据库、事件和日志上的表现一致且可预测。
 */
async function transitionNodeOffline(
  nodeId: string,
  reason: 'heartbeat_timeout' | 'session_disconnected',
  now = new Date()
): Promise<void> {
  const [row] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!row) return
  if (!shouldTransitionOfflineOnDisconnect(asRuntimeNode(row))) return

  await db
    .update(nodes)
    .set({
      status: 'offline',
      reachability: 'unreachable',
      updatedAt: now
    })
    .where(eq(nodes.id, row.id))

  if (row.reachability !== 'unreachable') {
    await publishEvent(
      'mnet.reachability.changed.v0',
      'mnet.reachability.changed',
      {
        nodeId: row.id,
        previousReachability: row.reachability,
        nextReachability: 'unreachable'
      }
    )
  }

  if (row.status !== 'offline') {
    await publishEvent(
      'node.status.changed.v0',
      'node.status.changed',
      {
        nodeId: row.id,
        previousStatus: row.status,
        nextStatus: 'offline',
        reason
      }
    )
  }

  await writeTimeline(`node became offline ${row.id}`, row.id)
  await writeFull('warn', `${reason} for ${row.id}`, undefined, undefined, { nodeId: row.id })
}

/**
 * 离线扫描通过“最后心跳时间 + 超时阈值”回收 agent，避免仅依赖 WebSocket close 造成状态漂移。
 */
async function markOfflineNodes(now = new Date()): Promise<void> {
  const rows = await db.select().from(nodes).where(eq(nodes.mode, 'agent'))
  const timeoutMs = heartbeatTimeoutMs()
  for (const row of rows) {
    if (!shouldTransitionOffline(asRuntimeNode(row), now, timeoutMs)) continue
    await transitionNodeOffline(row.id, 'heartbeat_timeout', now)
  }
}

const app = createMNetApp({
  async readiness() {
    const postgresReady = await client`select 1`
      .then(() => true)
      .catch(() => false)
    const [eventBusReady, logReady] = await Promise.all([
      fetchReadyState(`${serviceUrl('m-eventbus')}/ready`),
      fetchReadyState(`${serviceUrl('m-log')}/ready`)
    ])
    return { ready: postgresReady && eventBusReady && logReady }
  },
  createNetwork,
  listNetworks,
  joinNetwork,
  listMembers,
  executeNoop,
  profileStore,
  suspendedOps,
  approvals: approvalClient,
  events: profileEvents,
  log: profileLog,
  networkUpdater: {
    async setProfileVersion(networkId, profileVersion) {
      await db.update(networks).set({ profileVersion, updatedAt: new Date() }).where(eq(networks.id, networkId))
    }
  },
  policyAuthorize: {
    async authorize(actor, action, resource) {
      try {
        const response = await createInternalFetcher()(`${serviceUrl('m-policy')}/internal/v0/authorize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ actor, action, resource })
        })
        if (!response.ok) {
          return { result: 'deny' as const, id: crypto.randomUUID(), reasons: ['policy service unavailable'] }
        }
        const data = await response.json() as { decision: { result: string; id: string; reasons: string[] } }
        return { result: data.decision.result as 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval', id: data.decision.id, reasons: data.decision.reasons }
      } catch {
        return { result: 'deny' as const, id: crypto.randomUUID(), reasons: ['policy service unreachable'] }
      }
    }
  }
})

const internalServer = serveHttpApp('m-net', app.fetch)
// Join ingress 自己终止 TLS，并且只暴露 health 与 session 两个固定路径；
// 任何其他公开控制面入口都不应从这里扩张出去。
const joinIngress = Bun.serve<JoinSessionData>({
  hostname: '0.0.0.0',
  port: joinIngressPort(),
  tls: await joinTlsConfig(),
  fetch(request, server) {
    const url = new URL(request.url)
    if (url.pathname === '/join/v0/health') {
      return Response.json({ ok: true, service: 'm-net-join-ingress' })
    }
    if (url.pathname === '/join/v0/session') {
      const upgraded = server.upgrade(request, { data: {} })
      return upgraded ? undefined : new Response(JSON.stringify({ error: { code: 'join.upgrade_required', message: 'websocket upgrade required' } }), {
        status: 426,
        headers: { 'content-type': 'application/json' }
      })
    }
    return new Response('not found', { status: 404 })
  },
  websocket: {
    // WebSocket 消息处理显式区分 join、resume、heartbeat、log.forward 和 task.result，
    // 保证公网边界承载的是 M-Net session 协议，而不是 NATS 语义透传。
    async message(ws, rawMessage) {
      const message = parseClientMessage(messageText(rawMessage))
      if (!message) {
        sendServerMessage(ws, { type: 'error', code: 'session.invalid_message', message: 'invalid session message' })
        return
      }

      if (message.type === 'join.redeem') {
        const redeemed = await redeemJoinTicket(message)
        if (!redeemed.ok) {
          sendServerMessage(ws, { type: 'error', code: redeemed.error.code, message: redeemed.error.message })
          return
        }
        const nextSessionId = bindSession(ws, redeemed.value.node.id)
        sendServerMessage(ws, {
          type: 'join.accepted',
          sessionId: nextSessionId,
          node: redeemed.value.node,
          runtimeToken: redeemed.value.runtimeToken,
          issuedAt: redeemed.value.issuedAt
        })
        return
      }

      if (message.type === 'session.resume') {
        const resumed = await resumeSession(message)
        if (!resumed.ok) {
          sendServerMessage(ws, { type: 'error', code: resumed.error.code, message: resumed.error.message })
          return
        }
        const nextSessionId = bindSession(ws, resumed.value.id)
        sendServerMessage(ws, { type: 'session.resumed', sessionId: nextSessionId, node: resumed.value })
        return
      }

      const sessionAuth = authorizeSessionMessage(
        sessionNodeId(ws),
        'sessionId' in message ? message.sessionId : undefined,
        sessionNodeId(ws) ? activeSessionIds.get(sessionNodeId(ws) as string) : undefined
      )
      if (!sessionAuth.ok) {
        sendServerMessage(ws, { type: 'error', code: sessionAuth.code, message: sessionAuth.message })
        return
      }

      if (message.type === 'heartbeat') {
        const heartbeatApplied = await applyHeartbeat(sessionAuth.nodeId, message)
        if (!heartbeatApplied.ok) {
          sendServerMessage(ws, { type: 'error', code: heartbeatApplied.error.code, message: heartbeatApplied.error.message })
        }
        return
      }

      if (message.type === 'log.forward') {
        await forwardLog(sessionAuth.nodeId, message)
        return
      }

      if (message.type === 'task.result') {
        const pending = pendingTasks.get(message.taskId)
        if (!pending || pending.nodeId !== sessionAuth.nodeId) {
          sendServerMessage(ws, { type: 'error', code: 'task.not_found', message: 'task result does not match an active task' })
          return
        }
        void writeFull('info', `completed noop task ${message.taskId}`, pending.correlationId, undefined, {
          nodeId: sessionAuth.nodeId,
          taskId: message.taskId,
          channel: 'session.task.result'
        })
        pending.resolve({
          nodeId: sessionAuth.nodeId,
          taskId: message.taskId,
          result: message.result,
          completedAt: message.completedAt
        })
      }
    },
    close(ws) {
      const nodeId = sessionNodeId(ws)
      if (!nodeId) return
      const currentSessionId = activeSessionIds.get(nodeId)
      const closedSessionId = sessionId(ws)
      if (closedSessionId && currentSessionId === closedSessionId) {
        activeSessionIds.delete(nodeId)
        activeSessions.delete(nodeId)
        rejectPendingTasksForNode(nodeId, { code: 'node.unreachable', message: 'node session disconnected' })
        void transitionNodeOffline(nodeId, 'session_disconnected')
      }
    }
  }
})

const offlineSweep = setInterval(() => {
  void markOfflineNodes()
}, Math.max(heartbeatTimeoutMs(), 5000))

process.on('SIGINT', () => {
  clearInterval(offlineSweep)
  for (const [taskId, pending] of pendingTasks.entries()) {
    clearTimeout(pending.timeout)
    pendingTasks.delete(taskId)
    pending.reject({ code: 'mnet.unavailable', message: 'm-net is shutting down' })
  }
  joinIngress.stop(true)
  void internalServer
    .stop()
    .then(() => client.end())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-net internal listening on http://127.0.0.1:${internalServicePorts['m-net']}`)
console.log(`m-net join ingress listening on https://0.0.0.0:${joinIngressPort()}`)
