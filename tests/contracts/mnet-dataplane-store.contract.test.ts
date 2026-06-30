import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import { migrateFoundation } from '../../packages/db/src/migrate-foundation.ts'
import { migrateMNetDataPlane } from '../../packages/db/src/migrate-mnet-dataplane.ts'
import { migrateServices } from '../../packages/db/src/migrate-services.ts'
import { createInMemoryDataPlaneStores } from '../../services/m-net/src/data-plane-store-memory.ts'
import { createPgDataPlaneStores } from '../../services/m-net/src/data-plane-store-pg.ts'
import type { DataPlaneStores } from '../../services/m-net/src/data-plane-store-types.ts'
import {
  createInMemoryGlobalDefaultsStore,
  type GlobalDefaultsStore
} from '../../services/m-net/src/global-defaults-store.ts'
import { createPgGlobalDefaultsStore } from '../../services/m-net/src/global-defaults-store-pg.ts'
import {
  createInMemoryProfileDisablePolicyStore,
  createPgProfileDisablePolicyStore,
  type ProfileDisablePolicyStore
} from '../../services/m-net/src/profile-disable-policy.ts'
import {
  createInMemoryProfileStore,
  createPgProfileStore,
  type ProfileStore
} from '../../services/m-net/src/profile-store.ts'
import {
  createInMemorySuspendedOperationStore,
  createPgSuspendedOperationStore,
  type SuspendedOperationStore
} from '../../services/m-net/src/suspended-operations.ts'

const pgAvailable = await (async () => {
  try {
    const client = createSqlClient()
    await client`select 1`
    await client.end()
    return true
  } catch {
    return false
  }
})()

let pgMigrated = false

async function ensurePgSchema(): Promise<void> {
  if (!pgAvailable || pgMigrated) return
  const client = createSqlClient()
  await client.begin(async tx => {
    await migrateFoundation(tx)
    await migrateServices(tx)
    await migrateMNetDataPlane(tx)
  })
  await client.end()
  pgMigrated = true
}

async function resetPgState(): Promise<void> {
  const client = createSqlClient()
  // 使用事务 + 显式锁避免与其他 PG 测试并行 truncate 死锁
  await client.begin(async tx => {
    await tx`
      truncate table
        mnet_partition_states,
        mnet_sidecar_desired_configs,
        mnet_data_plane_operation_locks,
        mnet_relay_assignments,
        mnet_tunnel_address_allocations,
        mnet_node_public_keys,
        mnet_network_map_renders,
        mnet_profile_migrations,
        mnet_profile_disable_policies,
        mnet_profile_default_set_results,
        mnet_profile_switch_snapshots,
        mnet_profile_switch_results,
        mnet_profile_switch_batch_members,
        mnet_profile_switch_batches,
        mnet_profile_switch_operations,
        mnet_global_defaults,
        mnet_suspended_operations,
        mnet_profile_transitions,
        mnet_network_profile_states,
        mnet_profile_definitions,
        network_memberships,
        policy_approval_votes,
        policy_approvals,
        policy_decisions,
        networks,
        node_credentials,
        node_join_tickets,
        tasks,
        service_definitions,
        nodes
      restart identity cascade
    `
    const now = new Date()
    await tx`
      insert into nodes (id, kind, name, mode, status, reachability, capabilities, scope, created_at, updated_at)
      values
        ('node-a', 'leaf', 'Node A', 'managed', 'ready', 'public', '{}'::jsonb, '{}'::jsonb, ${now}, ${now}),
        ('node-b', 'leaf', 'Node B', 'managed', 'ready', 'private', '{}'::jsonb, '{}'::jsonb, ${now}, ${now}),
        ('relay-a', 'leaf', 'Relay A', 'managed', 'ready', 'public', '{}'::jsonb, '{}'::jsonb, ${now}, ${now})
    `
    await tx`
      insert into networks (id, name, profile_version, status, created_at, updated_at)
      values ('net-a', 'Network A', 'm-net-default@0.1.0', 'ready', ${now}, ${now})
    `
    await tx`
      insert into policy_decisions (id, actor, action, resource, result, reasons, created_at)
      values ('pd-1', 'admin', 'network:profile-enable', 'network/net-a', 'allow', '[]'::jsonb, ${now})
    `
  })
  await client.end()
}

async function exerciseProfileStore(store: ProfileStore): Promise<void> {
  const definitions = await store.getDefinitions()
  expect(definitions.length).toBeGreaterThanOrEqual(2)
  await store.setNetworkState('net-a', { profileVersion: 'm-net-cn@0.3.0', status: 'enabled' })
  const state = await store.getNetworkState('net-a')
  expect(state?.profileVersion).toBe('m-net-cn@0.3.0')
  await store.recordTransition({
    networkId: 'net-a',
    fromVersion: 'm-net-default@0.1.0',
    toVersion: 'm-net-cn@0.3.0',
    fromStatus: 'disabled',
    toStatus: 'enabled',
    actor: 'admin',
    reason: 'contract coverage'
  })
}

async function exerciseGlobalDefaultsStore(store: GlobalDefaultsStore): Promise<void> {
  await store.setDefaultProfileVersion('m-net-cn@0.3.0')
  expect(await store.getDefaultProfileVersion()).toBe('m-net-cn@0.3.0')
  const operation = await store.createSwitchOperation({
    idempotencyKey: 'idem-switch',
    targetProfileVersion: 'm-net-cn@0.3.0',
    batchSize: 1,
    reason: 'contract coverage',
    batches: [{ batchId: 1, networkIds: ['net-a'] }]
  })
  expect(operation.batches).toHaveLength(1)
  await store.startBatch(operation.operationId, 1)
  await store.completeBatch(operation.operationId, 1, [
    {
      networkId: 'net-a',
      previousProfileVersion: 'm-net-default@0.1.0',
      targetProfileVersion: 'm-net-cn@0.3.0',
      status: 'applied',
      auditId: 'audit-1',
      correlationId: 'corr-1'
    }
  ])
  await store.setSwitchState(operation.operationId, 'applied')
  expect(await store.getAppliedNetworks(operation.operationId)).toEqual(['net-a'])
  expect((await store.getMigrationSnapshot(operation.operationId)).get('net-a')).toBeDefined()
  await store.recordDefaultSetResult('idem-default', {
    operationId: operation.operationId,
    policyDecisionId: 'pd-1',
    auditId: 'audit-1'
  })
  expect(await store.getDefaultSetResultByIdempotencyKey('idem-default')).toEqual({
    operationId: operation.operationId,
    policyDecisionId: 'pd-1',
    auditId: 'audit-1'
  })
}

async function exerciseSuspendedStore(store: SuspendedOperationStore): Promise<void> {
  const created = await store.create({
    policyDecisionId: 'pd-1',
    action: 'mnet.profile.enable',
    networkId: 'net-a',
    fromProfileVersion: 'm-net-default@0.1.0',
    toProfileVersion: 'm-net-cn@0.3.0',
    requestedBy: 'admin',
    reason: 'contract coverage',
    correlationId: 'corr-suspended',
    idempotencyKey: 'idem-suspended',
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  })
  expect((await store.get(created.id))?.status).toBe('suspended')
  expect((await store.getByPolicyDecisionId('pd-1'))?.id).toBe(created.id)
  expect((await store.transition(created.id, 'resumed', 'approved'))?.status).toBe('resumed')
}

async function exerciseDisablePolicyStore(store: ProfileDisablePolicyStore): Promise<void> {
  expect((await store.getPolicy()).emergencyBreakGlassEnabled).toBe(true)
  const updated = await store.setPolicy({
    requireApproval: true,
    emergencyBreakGlassEnabled: false,
    reason: 'contract coverage',
    idempotencyKey: 'idem-policy'
  })
  expect(updated.requireApproval).toBe(true)
  expect((await store.getPolicy()).reason).toBe('contract coverage')
}

async function exerciseDataPlaneStores(stores: DataPlaneStores): Promise<void> {
  await stores.profileMigrations.upsert({
    networkId: 'net-a',
    operationId: 'migration-1',
    fromVersion: 'm-net-default@0.1.0',
    toVersion: 'm-net-cn@0.3.0',
    status: 'completed',
    idempotencyKey: 'idem-migration',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:01:00.000Z',
    auditMetadata: { actor: 'admin' }
  })
  expect(await stores.profileMigrations.get('net-a', 'migration-1')).not.toBeNull()

  await stores.networkMaps.save({
    networkId: 'net-a',
    mapVersion: 1,
    profileVersion: 'm-net-cn@0.3.0',
    map: {
      networkId: 'net-a',
      profileVersion: 'm-net-cn@0.3.0',
      mapVersion: 1,
      expiresAt: Date.now() + 60_000,
      members: [],
      aclRules: [],
      signatureMetadata: {
        algorithm: 'ed25519',
        keyId: 'key-1',
        publicKey: 'public-key-1',
        value: 'sig-1'
      }
    },
    signatureMetadata: { keyId: 'key-1', signer: 'ops' },
    expiresAt: '2026-01-01T00:02:00.000Z',
    publishedAt: '2026-01-01T00:01:30.000Z'
  })
  expect((await stores.networkMaps.getLatest('net-a'))?.mapVersion).toBe(1)

  await stores.nodePublicKeys.upsert({
    nodeId: 'node-a',
    keyId: 'key-1',
    publicKey: 'pub-1',
    fingerprint: 'fp-1',
    algorithm: 'wireguard-x25519',
    createdAt: '2026-01-01T00:00:00.000Z',
    rotationDueAt: '2026-02-01T00:00:00.000Z',
    rotationCounter: 1,
    status: 'active'
  })
  expect((await stores.nodePublicKeys.get('node-a', 'key-1'))?.fingerprint).toBe('fp-1')

  await stores.tunnelAllocations.upsert({
    networkId: 'net-a',
    nodeId: 'node-a',
    subnetCidr: '10.0.0.0/24',
    tunnelIp: '10.0.0.2',
    allocatedAt: '2026-01-01T00:00:00.000Z'
  })
  expect((await stores.tunnelAllocations.get('net-a', 'node-a'))?.tunnelIp).toBe('10.0.0.2')

  await stores.relayAssignments.upsert({
    networkId: 'net-a',
    relayId: 'relay-a',
    relayType: 'wstunnel',
    endpoint: 'wss://relay.example.test',
    assignedAt: '2026-01-01T00:00:00.000Z'
  })
  expect((await stores.relayAssignments.listByNetwork('net-a'))[0]?.relayId).toBe('relay-a')

  await stores.operationLocks.upsert({
    networkId: 'net-a',
    operationType: 'migration',
    operationId: 'lock-1',
    idempotencyKey: 'idem-lock',
    acquiredAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-01T00:10:00.000Z',
    status: 'active',
    lockRowId: 'row-1',
    fencingToken: 1,
    updatedAt: '2026-01-01T00:00:01.000Z'
  })
  expect((await stores.operationLocks.getActiveByNetwork('net-a'))?.operationId).toBe('lock-1')

  await stores.sidecarDesiredConfigs.upsert({
    nodeId: 'node-a',
    configHash: 'hash-1',
    desiredAt: '2026-01-01T00:00:00.000Z',
    appliedAt: '2026-01-01T00:00:10.000Z'
  })
  expect((await stores.sidecarDesiredConfigs.get('node-a'))?.configHash).toBe('hash-1')

  await stores.partitionStates.upsert({
    networkId: 'net-a',
    state: 'stale',
    reason: { code: 'network_map.stale', staleForMs: 30_000 },
    transitionedAt: '2026-01-01T00:00:00.000Z',
    previousState: 'connected'
  })
  expect((await stores.partitionStates.get('net-a'))?.state).toBe('stale')
}

describe('M-Net persistent store contract (in-memory)', () => {
  let profileStore: ProfileStore
  let globalDefaultsStore: GlobalDefaultsStore
  let suspendedStore: SuspendedOperationStore
  let disablePolicyStore: ProfileDisablePolicyStore
  let dataPlaneStores: DataPlaneStores

  beforeEach(() => {
    profileStore = createInMemoryProfileStore()
    globalDefaultsStore = createInMemoryGlobalDefaultsStore(profileStore)
    suspendedStore = createInMemorySuspendedOperationStore()
    disablePolicyStore = createInMemoryProfileDisablePolicyStore()
    dataPlaneStores = createInMemoryDataPlaneStores()
  })

  it('keeps the shared control-plane and data-plane contract behavior', async () => {
    await exerciseProfileStore(profileStore)
    await exerciseGlobalDefaultsStore(globalDefaultsStore)
    await exerciseSuspendedStore(suspendedStore)
    await exerciseDisablePolicyStore(disablePolicyStore)
    await exerciseDataPlaneStores(dataPlaneStores)
  })
})

describe('M-Net persistent store contract (postgres)', () => {
  beforeAll(async () => {
    if (!pgAvailable) return
    await ensurePgSchema()
  })

  beforeEach(async () => {
    if (!pgAvailable) return
    await resetPgState()
  })

  it('skips gracefully when PostgreSQL is unavailable', async () => {
    if (!pgAvailable) return
    expect(pgAvailable).toBe(true)
  })

  it('matches the in-memory contract with PostgreSQL stores', async () => {
    if (!pgAvailable) return
    const { db, client } = createDb()
    const profileStore = createPgProfileStore(db)
    const globalDefaultsStore = createPgGlobalDefaultsStore(db, profileStore)
    const suspendedStore = createPgSuspendedOperationStore(db)
    const disablePolicyStore = createPgProfileDisablePolicyStore(db)
    const dataPlaneStores = createPgDataPlaneStores(db)
    await exerciseProfileStore(profileStore)
    await exerciseGlobalDefaultsStore(globalDefaultsStore)
    await exerciseSuspendedStore(suspendedStore)
    await exerciseDisablePolicyStore(disablePolicyStore)
    await exerciseDataPlaneStores(dataPlaneStores)
    await client.end()
  })
})
