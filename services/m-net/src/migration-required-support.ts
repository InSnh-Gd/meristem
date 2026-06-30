import { and, eq } from 'drizzle-orm'
import type {
  MNetMigrationReportFromSchema,
  MNetMigrationReportItemFromSchema,
  MNetMigrationRequired,
  MNetMigrationRequiredReasonCodeFromSchema,
  MNetProfileV03CompatibilityResultFromSchema,
  MNetNodeV03CompatibilityResultFromSchema
} from '../../../packages/contracts/src/index.ts'
import {
  decodeMNetNodeV03Compatibility,
  decodeMNetProfileV03Compatibility,
  MNetProfileV03VersionSchema
} from '../../../packages/contracts/src/index.ts'
import * as Schema from 'effect/Schema'
import {
  mnetNetworkProfileStates,
  networkMemberships,
  nodes
} from '../../../packages/db/src/schema.ts'
import type { MNetDb } from './clients.ts'
import {
  type ProfileWorkflowFailure,
  profileWorkflowFailure,
  type ProfileWriteBody,
  type RouteSet
} from './profile-workflow-types.ts'
import type { ProfileStore } from './profile-store.ts'

export const migrationFixtureIds = {
  oldProfile: 'fixture-profile-cn-wstunnel',
  oldNodeAgentCapability: 'fixture-node-legacy-agent-capability',
  wrongNodeKind: 'fixture-node-wrong-kind',
  unreachableNode: 'fixture-node-unreachable',
  missingPermission: 'fixture-node-missing-permission'
} as const

const legacyNodeAgentCapability = 'node-agent.wstunnel.v0.2'

type JoinedNodeRow = {
  id: string
  kind: string
  mode: string
  status: string
  reachability: string
  agentVersion: string | null
  capabilities: unknown
  networkId: string | null
  networkProfileVersion: string | null
}

type MigrationReportDeps = {
  db: MNetDb
  profileStore: NonNullable<ProfileStore>
}

function asCapabilities(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function hasLegacyNodeAgentCapability(node: JoinedNodeRow): boolean {
  return asCapabilities(node.capabilities).includes(legacyNodeAgentCapability)
}

function targetProfileVersionFor(profileVersion: string): 'm-net@0.3.0' | 'm-net-cn@0.3.0' {
  return profileVersion.startsWith('m-net-cn@') ? 'm-net-cn@0.3.0' : 'm-net@0.3.0'
}

function profileMigrationFor(
  profileId: string,
  profileVersion: string
): MNetMigrationRequired | null {
  try {
    Schema.decodeUnknownSync(MNetProfileV03VersionSchema)(profileVersion)
    return null
  } catch {
    // keep legacy compatibility path
  }

  const compatibility: MNetProfileV03CompatibilityResultFromSchema =
    decodeMNetProfileV03Compatibility({
      profileId,
      profileVersion
    })
  return compatibility.kind === 'migration_required' ? compatibility.migration : null
}

function nodeMigrationFor(node: JoinedNodeRow): MNetMigrationRequired | null {
  if (node.networkProfileVersion === null) return null
  if (!node.networkProfileVersion.startsWith('m-net')) return null

  const compatibility: MNetNodeV03CompatibilityResultFromSchema = decodeMNetNodeV03Compatibility({
    nodeId: node.id,
    profileVersion: targetProfileVersionFor(node.networkProfileVersion),
    transport: hasLegacyNodeAgentCapability(node) ? 'wstunnel' : 'netbird-sidecar'
  })
  return compatibility.kind === 'migration_required' ? compatibility.migration : null
}

function resourceItem(
  resourceKind: 'profile' | 'node',
  resourceId: string,
  migration: MNetMigrationRequired
) {
  const item: MNetMigrationReportItemFromSchema = { resourceKind, resourceId, migration }
  return item
}

async function listJoinedNodes(db: MNetDb): Promise<JoinedNodeRow[]> {
  return db
    .select({
      id: nodes.id,
      kind: nodes.kind,
      mode: nodes.mode,
      status: nodes.status,
      reachability: nodes.reachability,
      agentVersion: nodes.agentVersion,
      capabilities: nodes.capabilities,
      networkId: networkMemberships.networkId,
      networkProfileVersion: mnetNetworkProfileStates.profileVersion
    })
    .from(nodes)
    .leftJoin(
      networkMemberships,
      and(eq(networkMemberships.nodeId, nodes.id), eq(networkMemberships.status, 'joined'))
    )
    .leftJoin(
      mnetNetworkProfileStates,
      eq(mnetNetworkProfileStates.networkId, networkMemberships.networkId)
    )
}

function migrationFailure(
  migration: MNetMigrationRequired,
  status: ProfileWorkflowFailure['status'] = 409
): ProfileWorkflowFailure {
  return {
    kind: 'failure',
    ok: false,
    status,
    error: {
      code: 'migration_required',
      message: migration.message,
      migration
    }
  }
}

export async function buildMigrationReport(
  deps: MigrationReportDeps
): Promise<MNetMigrationReportFromSchema> {
  const generatedAt = new Date().toISOString()
  const items: MNetMigrationReportItemFromSchema[] = []

  for (const profile of await deps.profileStore.getDefinitions()) {
    const migration = profileMigrationFor(profile.profileVersion, profile.profileVersion)
    if (migration) {
      items.push(resourceItem('profile', profile.profileVersion, migration))
    }
  }

  for (const node of await listJoinedNodes(deps.db)) {
    const migration = nodeMigrationFor(node)
    if (migration) {
      items.push(resourceItem('node', node.id, migration))
    }
  }

  return {
    status: items.length > 0 ? 'migration_required' : 'ok',
    generatedAt,
    items
  }
}

function legacyDefaultProfileMigration(): MNetMigrationRequired {
  return {
    code: 'migration_required',
    message: 'legacy default control-plane profile must migrate to NetBird profile v0.3.0',
    targetProfileVersion: 'm-net@0.3.0',
    rebuildGuidanceKey: 'migrate_profile_to_mnet_v03',
    affectedProfileIds: ['m-net-default@0.1.0'],
    affectedNodeIds: [],
    reasonCode: 'legacy_profile_v0_1'
  }
}

function legacyCnControlPlaneMigration(): MNetMigrationRequired {
  return {
    code: 'migration_required',
    message: 'legacy CN control-plane profile must migrate to NetBird CN profile v0.3.0',
    targetProfileVersion: 'm-net-cn@0.3.0',
    rebuildGuidanceKey: 'migrate_profile_to_mnet_cn_v03',
    affectedProfileIds: ['m-net-cn@0.1.0'],
    affectedNodeIds: [],
    reasonCode: 'legacy_cn_profile_v0_1'
  }
}

function legacyWstunnelProfileMigration(): MNetMigrationRequired {
  return {
    code: 'migration_required',
    message: 'wstunnel production profile must migrate to NetBird CN profile v0.3.0',
    targetProfileVersion: 'm-net-cn@0.3.0',
    rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
    affectedProfileIds: ['m-net-cn@0.2.0'],
    affectedNodeIds: [],
    reasonCode: 'legacy_wstunnel_profile_v0_2'
  }
}

function legacyNodeRuntimeMigration(nodeId: string): MNetMigrationRequired {
  return {
    code: 'migration_required',
    message:
      'node runtime must rebuild onto the NetBird sidecar path before it can join v0.3.0 data plane',
    targetProfileVersion: 'm-net-cn@0.3.0',
    rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
    affectedProfileIds: ['m-net-cn@0.3.0'],
    affectedNodeIds: [nodeId],
    reasonCode: 'legacy_wstunnel_node'
  }
}

export function isMigrationRequiredFailure(
  value: unknown
): value is ProfileWorkflowFailure & { error: { migration: MNetMigrationRequired } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: string }).kind === 'failure' &&
    'error' in value &&
    typeof (value as { error?: { code?: string } }).error?.code === 'string' &&
    (value as { error?: { code?: string } }).error?.code === 'migration_required' &&
    typeof (value as { error?: { migration?: unknown } }).error?.migration === 'object'
  )
}

export function externalMigrationRequiredApiError(
  set: RouteSet,
  code: 400 | 401 | 403 | 404 | 409 | 503,
  migration: MNetMigrationRequired
): never {
  set.status = code
  return {
    error: {
      code: 'migration_required',
      message: migration.message,
      migration
    }
  } as never
}

export function externalMigrationRequiredRouteBody(
  migration: MNetMigrationRequired,
  correlationId?: string
) {
  return {
    error: {
      code: 'migration_required' as const,
      message: migration.message,
      ...(correlationId ? { correlationId } : {}),
      migration
    }
  }
}

export async function requireSupportedProfileVersion(
  profileStore: ProfileStore,
  profileVersion: ProfileWriteBody['profileVersion'],
  currentProfileVersion?: string
): Promise<true | ProfileWorkflowFailure> {
  const definition = await profileStore.getDefinition(profileVersion)
  if (!definition) {
    return profileWorkflowFailure(404, 'profile.not_found', 'profile not found')
  }

  if (profileVersion === 'm-net@0.3.0') {
    if (currentProfileVersion === 'm-net-default@0.1.0') {
      return migrationFailure(legacyDefaultProfileMigration())
    }
    return true
  }

  if (currentProfileVersion === 'm-net-cn@0.1.0') {
    return migrationFailure(legacyCnControlPlaneMigration())
  }

  if (currentProfileVersion === 'm-net-cn@0.2.0') {
    return migrationFailure(legacyWstunnelProfileMigration())
  }

  return true
}

export async function guardLegacyNodeRuntime(
  db: MNetDb,
  nodeId: string
): Promise<{ networkId: string } | ProfileWorkflowFailure> {
  const [nodeRow] = await db.select().from(nodes).where(eq(nodes.id, nodeId)).limit(1)
  if (!nodeRow) {
    return profileWorkflowFailure(404, 'node.not_found', 'node not found')
  }

  const [membership] = await db
    .select()
    .from(networkMemberships)
    .where(and(eq(networkMemberships.nodeId, nodeId), eq(networkMemberships.status, 'joined')))
    .limit(1)
  if (!membership) {
    return profileWorkflowFailure(404, 'network.not_found', 'network not found for node runtime')
  }

  const isLegacyAgent =
    typeof nodeRow.agentVersion === 'string' && nodeRow.agentVersion.startsWith('0.1.')

  if (isLegacyAgent) {
    return migrationFailure(legacyNodeRuntimeMigration(nodeId))
  }

  return { networkId: membership.networkId }
}
