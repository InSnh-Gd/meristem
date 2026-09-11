import type {
  DataPlaneStores,
  StoredNetworkMapRender,
  StoredProfileMigration,
  StoredRelayAssignment,
  StoredSidecarDesiredConfig,
  StoredTunnelAddressAllocation
} from './data-plane-store-types.ts'
import type { NetworkOperationLock } from './operation-locks.ts'
import type { NetworkPartitionState } from './partition-state.ts'

/**
 * 创建内存数据面状态存储，仅供测试与显式 fixture 使用，不用于生产接线。
 */
export function createInMemoryDataPlaneStores(): DataPlaneStores {
  const profileMigrations = new Map<string, StoredProfileMigration>()
  const networkMaps = new Map<string, StoredNetworkMapRender>()
  const publicKeys = new Map<
    string,
    {
      nodeId: string
      keyId: string
      publicKey: string
      fingerprint: string
      algorithm: 'wireguard-x25519'
      createdAt: string
      rotatedAt?: string
      rotationCounter: number
      rotationDueAt?: string
      status: string
    }
  >()
  const tunnelAllocations = new Map<string, StoredTunnelAddressAllocation>()
  const relayAssignments = new Map<string, StoredRelayAssignment>()
  const operationLocks = new Map<string, NetworkOperationLock>()
  const sidecarDesiredConfigs = new Map<string, StoredSidecarDesiredConfig>()
  const partitionStates = new Map<string, NetworkPartitionState>()

  return {
    profileMigrations: {
      async upsert(record) {
        profileMigrations.set(`${record.networkId}:${record.operationId}`, { ...record })
      },
      async get(networkId, operationId) {
        const record = profileMigrations.get(`${networkId}:${operationId}`)
        return record ? { ...record } : null
      },
      async listByNetwork(networkId) {
        return [...profileMigrations.values()]
          .filter(record => record.networkId === networkId)
          .map(record => ({ ...record }))
      }
    },
    networkMaps: {
      async save(record) {
        networkMaps.set(`${record.networkId}:${record.mapVersion}`, { ...record })
      },
      async get(networkId, mapVersion) {
        const record = networkMaps.get(`${networkId}:${mapVersion}`)
        return record ? { ...record } : null
      },
      async getLatest(networkId) {
        const records = [...networkMaps.values()].filter(record => record.networkId === networkId)
        const latest = records.sort((left, right) => right.mapVersion - left.mapVersion)[0]
        return latest ? { ...latest } : null
      }
    },
    nodePublicKeys: {
      async upsert(record) {
        publicKeys.set(`${record.nodeId}:${record.keyId}`, { ...record })
      },
      async get(nodeId, keyId) {
        const record = publicKeys.get(`${nodeId}:${keyId}`)
        return record ? { ...record } : null
      },
      async listByNode(nodeId) {
        return [...publicKeys.values()]
          .filter(record => record.nodeId === nodeId)
          .map(record => ({ ...record }))
      },
      async getByFingerprint(fingerprint) {
        const record = [...publicKeys.values()].find(
          candidate => candidate.fingerprint === fingerprint
        )
        return record ? { ...record } : null
      }
    },
    tunnelAllocations: {
      async upsert(record) {
        tunnelAllocations.set(`${record.networkId}:${record.nodeId}`, { ...record })
      },
      async listByNetwork(networkId) {
        return [...tunnelAllocations.values()]
          .filter(record => record.networkId === networkId)
          .map(record => ({ ...record }))
      },
      async get(networkId, nodeId) {
        const record = tunnelAllocations.get(`${networkId}:${nodeId}`)
        return record ? { ...record } : null
      }
    },
    relayAssignments: {
      async upsert(record) {
        relayAssignments.set(`${record.networkId}:${record.relayId}`, { ...record })
      },
      async listByNetwork(networkId) {
        return [...relayAssignments.values()]
          .filter(record => record.networkId === networkId)
          .map(record => ({ ...record }))
      }
    },
    operationLocks: {
      async upsert(lock) {
        operationLocks.set(lock.operationId, { ...lock })
      },
      async getByOperationId(operationId) {
        const lock = operationLocks.get(operationId)
        return lock ? { ...lock } : null
      },
      async getActiveByNetwork(networkId) {
        const lock = [...operationLocks.values()].find(
          candidate => candidate.networkId === networkId && candidate.status === 'active'
        )
        return lock ? { ...lock } : null
      },
      async listByNetwork(networkId) {
        return [...operationLocks.values()]
          .filter(lock => lock.networkId === networkId)
          .map(lock => ({ ...lock }))
      }
    },
    sidecarDesiredConfigs: {
      async upsert(record) {
        sidecarDesiredConfigs.set(record.nodeId, { ...record })
      },
      async get(nodeId) {
        const record = sidecarDesiredConfigs.get(nodeId)
        return record ? { ...record } : null
      },
      async list() {
        return [...sidecarDesiredConfigs.values()].map(record => ({ ...record }))
      }
    },
    partitionStates: {
      async upsert(state) {
        partitionStates.set(state.networkId, { ...state })
      },
      async get(networkId) {
        const state = partitionStates.get(networkId)
        return state ? { ...state } : null
      }
    }
  }
}
