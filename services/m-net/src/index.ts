import { and, eq } from 'drizzle-orm'
import { connect } from '@nats-io/transport-node'
import { createDb } from '../../../packages/db/src/client.ts'
import { networkMemberships, networks, nodes } from '../../../packages/db/src/schema.ts'
import { serveJsonRequests, subjects } from '../../../packages/nats-rpc/src/index.ts'
import type {
  CreateNetworkRequest,
  MNetwork,
  MNetworkMember,
  NetworkSummary,
  NodeKind,
  NodeStatus
} from '../../../packages/contracts/src/index.ts'

type ServiceError = {
  code: string
  message: string
}

type ServiceResponse<T> =
  | { ok: true; value: T }
  | { ok: false; error: ServiceError }

type JoinNetworkRequest = {
  networkId: string
  nodeId: string
}

type ListMembersRequest = {
  networkId: string
}

const { db, client } = createDb()
const nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' })

function ok<T>(value: T): ServiceResponse<T> {
  return { ok: true, value }
}

function err(code: string, message: string): ServiceResponse<never> {
  return { ok: false, error: { code, message } }
}

function asNodeKind(value: string): NodeKind | null {
  return value === 'stem' || value === 'leaf' ? value : null
}

function membershipModeFor(kind: NodeKind): MNetworkMember['membershipMode'] {
  return kind === 'stem' ? 'full' : 'restricted'
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

async function createNetwork(input: CreateNetworkRequest): Promise<ServiceResponse<MNetwork>> {
  const existing = await db.select().from(networks).where(eq(networks.name, input.name)).limit(1)
  if (existing[0]) return err('network.conflict', 'network name already exists')

  const now = new Date()
  const network: typeof networks.$inferInsert = {
    id: crypto.randomUUID(),
    name: input.name,
    profileVersion: input.profileVersion ?? 'm-net-default@0.1.0',
    status: 'active',
    createdAt: now,
    updatedAt: now
  }

  await db.insert(networks).values(network)
  return ok(mapNetwork(network))
}

async function listNetworks(): Promise<ServiceResponse<NetworkSummary[]>> {
  const [networkRows, membershipRows] = await Promise.all([
    db.select().from(networks),
    db.select().from(networkMemberships)
  ])

  const summaries = networkRows.map((network) => ({
    ...mapNetwork(network),
    memberCount: membershipRows.filter((membership) => membership.networkId === network.id).length
  }))
  return ok(summaries)
}

async function joinNetwork(input: JoinNetworkRequest): Promise<ServiceResponse<MNetworkMember>> {
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

async function listMembers(input: ListMembersRequest): Promise<ServiceResponse<MNetworkMember[]>> {
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

  const members = rows.flatMap((row) => {
    const nodeKind = asNodeKind(row.nodeKind)
    if (!nodeKind) return []
    return [
      {
        networkId: row.networkId,
        nodeId: row.nodeId,
        nodeKind,
        membershipMode: row.membershipMode as MNetworkMember['membershipMode'],
        status: row.status as MNetworkMember['status'],
        joinedAt: row.joinedAt.toISOString()
      }
    ]
  })

  return ok(members)
}

void serveJsonRequests<CreateNetworkRequest, ServiceResponse<MNetwork>>(nc, subjects.networkCreate, createNetwork)
void serveJsonRequests<Record<string, never>, ServiceResponse<NetworkSummary[]>>(nc, subjects.networkList, listNetworks)
void serveJsonRequests<JoinNetworkRequest, ServiceResponse<MNetworkMember>>(nc, subjects.networkJoin, joinNetwork)
void serveJsonRequests<ListMembersRequest, ServiceResponse<MNetworkMember[]>>(nc, subjects.networkMembersList, listMembers)

process.on('SIGINT', () => {
  void nc.drain().then(() => client.end()).then(() => process.exit(0))
})

console.log('m-net listening')
