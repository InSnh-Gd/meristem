import { beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createDb, createSqlClient } from '../../packages/db/src/client.ts'
import { migrateFoundation } from '../../packages/db/src/migrate-foundation.ts'
import { migrateMNetDataPlane } from '../../packages/db/src/migrate-mnet-dataplane.ts'
import { migrateServices } from '../../packages/db/src/migrate-services.ts'
import { createPgDataPlaneStores } from '../../services/m-net/src/data-plane-store-pg.ts'
import { createPgGlobalDefaultsStore } from '../../services/m-net/src/global-defaults-store-pg.ts'
import { createPgProfileDisablePolicyStore } from '../../services/m-net/src/profile-disable-policy.ts'
import { createPgProfileStore } from '../../services/m-net/src/profile-store.ts'
import { createPgSuspendedOperationStore } from '../../services/m-net/src/suspended-operations.ts'

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
  await client`
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
  await client`
    insert into nodes (id, kind, name, mode, status, reachability, capabilities, scope, created_at, updated_at)
    values
      ('node-a', 'leaf', 'Node A', 'managed', 'ready', 'public', '{}'::jsonb, '{}'::jsonb, ${now}, ${now}),
      ('relay-a', 'leaf', 'Relay A', 'managed', 'ready', 'public', '{}'::jsonb, '{}'::jsonb, ${now}, ${now})
  `
  await client`
    insert into networks (id, name, profile_version, status, created_at, updated_at)
    values ('net-a', 'Network A', 'm-net-default@0.1.0', 'ready', ${now}, ${now})
  `
  await client`
    insert into policy_decisions (id, actor, action, resource, result, reasons, created_at)
    values ('pd-1', 'admin', 'network:profile-enable', 'network/net-a', 'allow', '[]'::jsonb, ${now})
  `
  await client.end()
}

describe('M-Net PostgreSQL state persistence', () => {
  beforeAll(async () => {
    if (!pgAvailable) return
    await ensurePgSchema()
  })

  beforeEach(async () => {
    if (!pgAvailable) return
    await resetPgState()
  })

  it('skips gracefully when PostgreSQL is unavailable', () => {
    expect(typeof pgAvailable).toBe('boolean')
  })

  it('persists control-plane and data-plane state across store recreation', async () => {
    if (!pgAvailable) return

    const first = createDb()
    const firstProfileStore = createPgProfileStore(first.db)
    const firstGlobalDefaultsStore = createPgGlobalDefaultsStore(first.db, firstProfileStore)
    const firstSuspendedStore = createPgSuspendedOperationStore(first.db)
    const firstDisablePolicyStore = createPgProfileDisablePolicyStore(first.db)
    const firstDataPlaneStores = createPgDataPlaneStores(first.db)

    await firstProfileStore.setNetworkState('net-a', {
      profileVersion: 'm-net-cn@0.2.0',
      status: 'enabled'
    })
    const switchOperation = await firstGlobalDefaultsStore.createSwitchOperation({
      idempotencyKey: 'idem-restart',
      targetProfileVersion: 'm-net-cn@0.2.0',
      batchSize: 1,
      reason: 'restart persistence',
      batches: [{ batchId: 1, networkIds: ['net-a'] }]
    })
    await firstGlobalDefaultsStore.completeBatch(switchOperation.operationId, 1, [
      {
        networkId: 'net-a',
        previousProfileVersion: 'm-net-default@0.1.0',
        targetProfileVersion: 'm-net-cn@0.2.0',
        status: 'applied'
      }
    ])
    await firstGlobalDefaultsStore.recordDefaultSetResult('idem-default', {
      operationId: switchOperation.operationId,
      policyDecisionId: 'pd-1',
      auditId: 'audit-restart'
    })
    await firstDisablePolicyStore.setPolicy({
      requireApproval: true,
      emergencyBreakGlassEnabled: false,
      reason: 'restart persistence',
      idempotencyKey: 'idem-policy'
    })
    const suspended = await firstSuspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'net-a',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.2.0',
      requestedBy: 'admin',
      correlationId: 'corr-restart',
      idempotencyKey: 'idem-suspended',
      expiresAt: '2026-01-01T00:10:00.000Z'
    })
    await firstDataPlaneStores.profileMigrations.upsert({
      networkId: 'net-a',
      operationId: 'migration-1',
      fromVersion: 'm-net-default@0.1.0',
      toVersion: 'm-net-cn@0.2.0',
      status: 'completed',
      idempotencyKey: 'idem-migration',
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: '2026-01-01T00:01:00.000Z',
      auditMetadata: { actor: 'admin' }
    })
    await firstDataPlaneStores.networkMaps.save({
      networkId: 'net-a',
      mapVersion: 7,
      profileVersion: 'm-net-cn@0.2.0',
      map: {
        networkId: 'net-a',
        profileVersion: 'm-net-cn@0.2.0',
        mapVersion: 7,
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
      expiresAt: '2026-01-01T00:10:00.000Z',
      publishedAt: '2026-01-01T00:01:00.000Z'
    })
    await firstDataPlaneStores.nodePublicKeys.upsert({
      nodeId: 'node-a',
      keyId: 'key-1',
      publicKey: 'pub-1',
      fingerprint: 'fp-1',
      algorithm: 'wireguard-x25519',
      createdAt: '2026-01-01T00:00:00.000Z',
      rotationCounter: 1,
      status: 'active'
    })
    await firstDataPlaneStores.tunnelAllocations.upsert({
      networkId: 'net-a',
      nodeId: 'node-a',
      subnetCidr: '10.0.0.0/24',
      tunnelIp: '10.0.0.2',
      allocatedAt: '2026-01-01T00:00:00.000Z'
    })
    await firstDataPlaneStores.relayAssignments.upsert({
      networkId: 'net-a',
      relayId: 'relay-a',
      relayType: 'wstunnel',
      endpoint: 'wss://relay.example.test',
      assignedAt: '2026-01-01T00:00:00.000Z'
    })
    await firstDataPlaneStores.operationLocks.upsert({
      networkId: 'net-a',
      operationType: 'migration',
      operationId: 'lock-1',
      idempotencyKey: 'idem-lock',
      acquiredAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-01T00:05:00.000Z',
      status: 'active',
      lockRowId: 'row-1',
      fencingToken: 1,
      updatedAt: '2026-01-01T00:00:01.000Z'
    })
    await firstDataPlaneStores.sidecarDesiredConfigs.upsert({
      nodeId: 'node-a',
      configHash: 'hash-1',
      desiredAt: '2026-01-01T00:00:00.000Z'
    })
    await firstDataPlaneStores.partitionStates.upsert({
      networkId: 'net-a',
      state: 'stale',
      reason: { code: 'network_map.stale', staleForMs: 30_000 },
      transitionedAt: '2026-01-01T00:00:00.000Z',
      previousState: 'connected'
    })
    await first.client.end()

    const second = createDb()
    const secondProfileStore = createPgProfileStore(second.db)
    const secondGlobalDefaultsStore = createPgGlobalDefaultsStore(second.db, secondProfileStore)
    const secondSuspendedStore = createPgSuspendedOperationStore(second.db)
    const secondDisablePolicyStore = createPgProfileDisablePolicyStore(second.db)
    const secondDataPlaneStores = createPgDataPlaneStores(second.db)

    expect((await secondProfileStore.getNetworkState('net-a'))?.profileVersion).toBe(
      'm-net-cn@0.2.0'
    )
    expect(
      (await secondGlobalDefaultsStore.getSwitchOperation(switchOperation.operationId))?.results
    ).toHaveLength(1)
    expect(
      await secondGlobalDefaultsStore.getDefaultSetResultByIdempotencyKey('idem-default')
    ).toEqual({
      operationId: switchOperation.operationId,
      policyDecisionId: 'pd-1',
      auditId: 'audit-restart'
    })
    expect((await secondDisablePolicyStore.getPolicy()).requireApproval).toBe(true)
    expect((await secondSuspendedStore.get(suspended.id))?.policyDecisionId).toBe('pd-1')
    expect(
      (await secondDataPlaneStores.profileMigrations.get('net-a', 'migration-1'))?.status
    ).toBe('completed')
    expect((await secondDataPlaneStores.networkMaps.getLatest('net-a'))?.mapVersion).toBe(7)
    expect((await secondDataPlaneStores.nodePublicKeys.getByFingerprint('fp-1'))?.nodeId).toBe(
      'node-a'
    )
    expect((await secondDataPlaneStores.tunnelAllocations.get('net-a', 'node-a'))?.tunnelIp).toBe(
      '10.0.0.2'
    )
    expect((await secondDataPlaneStores.relayAssignments.listByNetwork('net-a'))[0]?.endpoint).toBe(
      'wss://relay.example.test'
    )
    expect(
      (await secondDataPlaneStores.operationLocks.getActiveByNetwork('net-a'))?.lockRowId
    ).toBe('row-1')
    expect((await secondDataPlaneStores.sidecarDesiredConfigs.get('node-a'))?.configHash).toBe(
      'hash-1'
    )
    expect((await secondDataPlaneStores.partitionStates.get('net-a'))?.state).toBe('stale')
    await second.client.end()
  })
})
