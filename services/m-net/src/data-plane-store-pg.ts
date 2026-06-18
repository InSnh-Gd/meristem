import { eq } from 'drizzle-orm'
import type { MeristemDb } from '../../../packages/db/src/client.ts'
import {
  mnetNetworkMapRenders,
  mnetNodePublicKeys,
  mnetProfileMigrations,
  mnetRelayAssignments,
  mnetTunnelAddressAllocations
} from '../../../packages/db/src/schema.ts'
import { createPgRuntimeDataPlaneStores } from './data-plane-store-pg-runtime.ts'
import type {
  DataPlaneStores,
  StoredNetworkMapRender,
  StoredProfileMigration,
  StoredRelayAssignment,
  StoredTunnelAddressAllocation
} from './data-plane-store-types.ts'
import { buildStoredNodePublicKey, decodeNetworkMap } from './store-codecs.ts'

/**
 * 创建 PostgreSQL 数据面状态存储，生产环境统一通过此入口接线。
 */
export function createPgDataPlaneStores(db: MeristemDb): DataPlaneStores {
  const runtimeStores = createPgRuntimeDataPlaneStores(db)
  return {
    profileMigrations: {
      async upsert(record: StoredProfileMigration) {
        await db
          .insert(mnetProfileMigrations)
          .values({
            networkId: record.networkId,
            operationId: record.operationId,
            fromVersion: record.fromVersion,
            toVersion: record.toVersion,
            status: record.status,
            idempotencyKey: record.idempotencyKey,
            startedAt: new Date(record.startedAt),
            completedAt: record.completedAt ? new Date(record.completedAt) : null,
            auditMetadata: record.auditMetadata
          })
          .onConflictDoUpdate({
            target: [mnetProfileMigrations.networkId, mnetProfileMigrations.operationId],
            set: {
              fromVersion: record.fromVersion,
              toVersion: record.toVersion,
              status: record.status,
              idempotencyKey: record.idempotencyKey,
              startedAt: new Date(record.startedAt),
              completedAt: record.completedAt ? new Date(record.completedAt) : null,
              auditMetadata: record.auditMetadata
            }
          })
      },
      async get(networkId, operationId) {
        const rows = await db
          .select()
          .from(mnetProfileMigrations)
          .where(eq(mnetProfileMigrations.networkId, networkId))
        const row = rows.find(candidate => candidate.operationId === operationId)
        return row
          ? {
              networkId: row.networkId,
              operationId: row.operationId,
              fromVersion: row.fromVersion,
              toVersion: row.toVersion,
              status: row.status,
              idempotencyKey: row.idempotencyKey,
              startedAt: row.startedAt.toISOString(),
              ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
              auditMetadata:
                typeof row.auditMetadata === 'object' && row.auditMetadata !== null
                  ? (row.auditMetadata as Record<string, unknown>)
                  : {}
            }
          : null
      },
      async listByNetwork(networkId) {
        const rows = await db
          .select()
          .from(mnetProfileMigrations)
          .where(eq(mnetProfileMigrations.networkId, networkId))
        return rows.map(row => ({
          networkId: row.networkId,
          operationId: row.operationId,
          fromVersion: row.fromVersion,
          toVersion: row.toVersion,
          status: row.status,
          idempotencyKey: row.idempotencyKey,
          startedAt: row.startedAt.toISOString(),
          ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
          auditMetadata:
            typeof row.auditMetadata === 'object' && row.auditMetadata !== null
              ? (row.auditMetadata as Record<string, unknown>)
              : {}
        }))
      }
    },
    networkMaps: {
      async save(record: StoredNetworkMapRender) {
        await db
          .insert(mnetNetworkMapRenders)
          .values({
            networkId: record.networkId,
            mapVersion: record.mapVersion,
            profileVersion: record.profileVersion,
            mapJson: record.map,
            signatureMetadata: record.signatureMetadata,
            expiresAt: new Date(record.expiresAt),
            publishedAt: new Date(record.publishedAt)
          })
          .onConflictDoUpdate({
            target: [mnetNetworkMapRenders.networkId, mnetNetworkMapRenders.mapVersion],
            set: {
              profileVersion: record.profileVersion,
              mapJson: record.map,
              signatureMetadata: record.signatureMetadata,
              expiresAt: new Date(record.expiresAt),
              publishedAt: new Date(record.publishedAt)
            }
          })
      },
      async get(networkId, mapVersion) {
        const rows = await db
          .select()
          .from(mnetNetworkMapRenders)
          .where(eq(mnetNetworkMapRenders.networkId, networkId))
        const row = rows.find(candidate => candidate.mapVersion === mapVersion)
        const map = row ? decodeNetworkMap(row.mapJson) : null
        return row && map
          ? {
              networkId: row.networkId,
              mapVersion: row.mapVersion,
              profileVersion: row.profileVersion,
              map,
              signatureMetadata:
                typeof row.signatureMetadata === 'object' && row.signatureMetadata !== null
                  ? (row.signatureMetadata as Record<string, unknown>)
                  : {},
              expiresAt: row.expiresAt.toISOString(),
              publishedAt: row.publishedAt.toISOString()
            }
          : null
      },
      async getLatest(networkId) {
        const rows = await db
          .select()
          .from(mnetNetworkMapRenders)
          .where(eq(mnetNetworkMapRenders.networkId, networkId))
        const latest = rows.sort((left, right) => right.mapVersion - left.mapVersion)[0]
        const map = latest ? decodeNetworkMap(latest.mapJson) : null
        return latest && map
          ? {
              networkId: latest.networkId,
              mapVersion: latest.mapVersion,
              profileVersion: latest.profileVersion,
              map,
              signatureMetadata:
                typeof latest.signatureMetadata === 'object' && latest.signatureMetadata !== null
                  ? (latest.signatureMetadata as Record<string, unknown>)
                  : {},
              expiresAt: latest.expiresAt.toISOString(),
              publishedAt: latest.publishedAt.toISOString()
            }
          : null
      }
    },
    nodePublicKeys: {
      async upsert(record) {
        await db
          .insert(mnetNodePublicKeys)
          .values({
            nodeId: record.nodeId,
            keyId: record.keyId,
            publicKey: record.publicKey,
            fingerprint: record.fingerprint,
            algorithm: record.algorithm,
            createdAt: new Date(record.createdAt),
            rotatedAt: record.rotatedAt ? new Date(record.rotatedAt) : null,
            rotationDueAt: record.rotationDueAt ? new Date(record.rotationDueAt) : null,
            rotationCounter: record.rotationCounter,
            status: record.status
          })
          .onConflictDoUpdate({
            target: [mnetNodePublicKeys.nodeId, mnetNodePublicKeys.keyId],
            set: {
              publicKey: record.publicKey,
              fingerprint: record.fingerprint,
              algorithm: record.algorithm,
              createdAt: new Date(record.createdAt),
              rotatedAt: record.rotatedAt ? new Date(record.rotatedAt) : null,
              rotationDueAt: record.rotationDueAt ? new Date(record.rotationDueAt) : null,
              rotationCounter: record.rotationCounter,
              status: record.status
            }
          })
      },
      async get(nodeId, keyId) {
        const rows = await db
          .select()
          .from(mnetNodePublicKeys)
          .where(eq(mnetNodePublicKeys.nodeId, nodeId))
        const row = rows.find(candidate => candidate.keyId === keyId)
        return hydrateStoredKey(row)
      },
      async listByNode(nodeId) {
        const rows = await db
          .select()
          .from(mnetNodePublicKeys)
          .where(eq(mnetNodePublicKeys.nodeId, nodeId))
        return rows.flatMap(row => {
          const key = hydrateStoredKey(row)
          return key ? [key] : []
        })
      },
      async getByFingerprint(fingerprint) {
        const [row] = await db
          .select()
          .from(mnetNodePublicKeys)
          .where(eq(mnetNodePublicKeys.fingerprint, fingerprint))
          .limit(1)
        return hydrateStoredKey(row)
      }
    },
    tunnelAllocations: createTunnelAllocationStore(db),
    relayAssignments: createRelayAssignmentStore(db),
    operationLocks: runtimeStores.operationLocks,
    sidecarDesiredConfigs: runtimeStores.sidecarDesiredConfigs,
    partitionStates: runtimeStores.partitionStates
  }
}

function hydrateStoredKey(row: typeof mnetNodePublicKeys.$inferSelect | undefined) {
  if (!row) return null
  const metadata = buildStoredNodePublicKey({
    nodeId: row.nodeId,
    keyId: row.keyId,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    algorithm: row.algorithm,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    rotationCounter: row.rotationCounter,
    rotationDueAt: row.rotationDueAt,
    status: row.status
  })
  return metadata
}

function createTunnelAllocationStore(
  db: MeristemDb
): Pick<DataPlaneStores, 'tunnelAllocations'>['tunnelAllocations'] {
  return {
    async upsert(record: StoredTunnelAddressAllocation) {
      await db
        .insert(mnetTunnelAddressAllocations)
        .values({
          networkId: record.networkId,
          nodeId: record.nodeId,
          subnetCidr: record.subnetCidr,
          tunnelIp: record.tunnelIp,
          allocatedAt: new Date(record.allocatedAt)
        })
        .onConflictDoUpdate({
          target: [mnetTunnelAddressAllocations.networkId, mnetTunnelAddressAllocations.nodeId],
          set: {
            subnetCidr: record.subnetCidr,
            tunnelIp: record.tunnelIp,
            allocatedAt: new Date(record.allocatedAt)
          }
        })
    },
    async listByNetwork(networkId) {
      const rows = await db
        .select()
        .from(mnetTunnelAddressAllocations)
        .where(eq(mnetTunnelAddressAllocations.networkId, networkId))
      return rows.map(row => ({
        networkId: row.networkId,
        nodeId: row.nodeId,
        subnetCidr: row.subnetCidr,
        tunnelIp: row.tunnelIp,
        allocatedAt: row.allocatedAt.toISOString()
      }))
    },
    async get(networkId, nodeId) {
      const rows = await db
        .select()
        .from(mnetTunnelAddressAllocations)
        .where(eq(mnetTunnelAddressAllocations.networkId, networkId))
      const row = rows.find(candidate => candidate.nodeId === nodeId)
      return row
        ? {
            networkId: row.networkId,
            nodeId: row.nodeId,
            subnetCidr: row.subnetCidr,
            tunnelIp: row.tunnelIp,
            allocatedAt: row.allocatedAt.toISOString()
          }
        : null
    }
  }
}

function createRelayAssignmentStore(
  db: MeristemDb
): Pick<DataPlaneStores, 'relayAssignments'>['relayAssignments'] {
  return {
    async upsert(record: StoredRelayAssignment) {
      await db
        .insert(mnetRelayAssignments)
        .values({
          networkId: record.networkId,
          relayId: record.relayId,
          relayType: record.relayType,
          endpoint: record.endpoint,
          assignedAt: new Date(record.assignedAt)
        })
        .onConflictDoUpdate({
          target: [mnetRelayAssignments.networkId, mnetRelayAssignments.relayId],
          set: {
            relayType: record.relayType,
            endpoint: record.endpoint,
            assignedAt: new Date(record.assignedAt)
          }
        })
    },
    async listByNetwork(networkId) {
      const rows = await db
        .select()
        .from(mnetRelayAssignments)
        .where(eq(mnetRelayAssignments.networkId, networkId))
      return rows.map(row => ({
        networkId: row.networkId,
        relayId: row.relayId,
        relayType: row.relayType,
        endpoint: row.endpoint,
        assignedAt: row.assignedAt.toISOString()
      }))
    }
  }
}
