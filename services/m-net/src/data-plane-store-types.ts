import type { NetworkMapFromSchema as NetworkMap } from '../../../packages/contracts/src/schemas/mnet-profile.ts'
import type {
  NetworkOperationLock,
  NetworkOperationType,
  OperationLockStatus
} from './operation-locks.ts'
import type { NetworkPartitionState } from './partition-state.ts'

export type StoredProfileMigration = {
  networkId: string
  fromVersion: string
  toVersion: string
  operationId: string
  status: string
  idempotencyKey: string
  startedAt: string
  completedAt?: string
  auditMetadata: Record<string, unknown>
}

export type StoredNetworkMapRender = {
  networkId: string
  mapVersion: number
  profileVersion: string
  map: NetworkMap
  signatureMetadata: Record<string, unknown>
  expiresAt: string
  publishedAt: string
}

export type StoredTunnelAddressAllocation = {
  networkId: string
  nodeId: string
  subnetCidr: string
  tunnelIp: string
  allocatedAt: string
}

export type StoredRelayAssignment = {
  networkId: string
  relayId: string
  relayType: string
  endpoint: string
  assignedAt: string
}

export type StoredSidecarDesiredConfig = {
  nodeId: string
  configHash: string
  desiredAt: string
  appliedAt?: string
}

export type StoredNodePublicKey = {
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

export type ProfileMigrationStore = {
  upsert(record: StoredProfileMigration): Promise<void>
  get(networkId: string, operationId: string): Promise<StoredProfileMigration | null>
  listByNetwork(networkId: string): Promise<StoredProfileMigration[]>
}

export type NetworkMapRenderStore = {
  save(record: StoredNetworkMapRender): Promise<void>
  get(networkId: string, mapVersion: number): Promise<StoredNetworkMapRender | null>
  getLatest(networkId: string): Promise<StoredNetworkMapRender | null>
}

export type NodePublicKeyStore = {
  upsert(record: StoredNodePublicKey): Promise<void>
  get(nodeId: string, keyId: string): Promise<StoredNodePublicKey | null>
  listByNode(nodeId: string): Promise<StoredNodePublicKey[]>
  getByFingerprint(fingerprint: string): Promise<StoredNodePublicKey | null>
}

export type TunnelAddressAllocationStore = {
  upsert(record: StoredTunnelAddressAllocation): Promise<void>
  listByNetwork(networkId: string): Promise<StoredTunnelAddressAllocation[]>
  get(networkId: string, nodeId: string): Promise<StoredTunnelAddressAllocation | null>
}

export type RelayAssignmentStore = {
  upsert(record: StoredRelayAssignment): Promise<void>
  listByNetwork(networkId: string): Promise<StoredRelayAssignment[]>
}

export type DataPlaneOperationLockStore = {
  upsert(lock: NetworkOperationLock): Promise<void>
  getByOperationId(operationId: string): Promise<NetworkOperationLock | null>
  getActiveByNetwork(networkId: string): Promise<NetworkOperationLock | null>
  listByNetwork(networkId: string): Promise<NetworkOperationLock[]>
}

export type SidecarDesiredConfigStore = {
  upsert(record: StoredSidecarDesiredConfig): Promise<void>
  get(nodeId: string): Promise<StoredSidecarDesiredConfig | null>
  list(): Promise<StoredSidecarDesiredConfig[]>
}

export type PartitionStateStore = {
  upsert(state: NetworkPartitionState): Promise<void>
  get(networkId: string): Promise<NetworkPartitionState | null>
}

export type DataPlaneStores = {
  profileMigrations: ProfileMigrationStore
  networkMaps: NetworkMapRenderStore
  nodePublicKeys: NodePublicKeyStore
  tunnelAllocations: TunnelAddressAllocationStore
  relayAssignments: RelayAssignmentStore
  operationLocks: DataPlaneOperationLockStore
  sidecarDesiredConfigs: SidecarDesiredConfigStore
  partitionStates: PartitionStateStore
}

export type StoredOperationLockRecord = {
  networkId: string
  operationType: NetworkOperationType
  operationId: string
  idempotencyKey?: string
  acquiredAt: string
  expiresAt: string
  status: OperationLockStatus
  lockRowId: string
  fencingToken: number
  updatedAt: string
}
