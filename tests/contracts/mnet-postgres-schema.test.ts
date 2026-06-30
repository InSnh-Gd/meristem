import { describe, expect, it } from 'bun:test'
import { getTableColumns } from 'drizzle-orm'
import * as schema from '../../packages/db/src/schema.ts'

describe('M-Net PostgreSQL schema contract', () => {
  it('defines M-Net profile tables and migration SQL', async () => {
    const migration = await Bun.file('packages/db/src/migrate.ts').text()

    expect(schema).toHaveProperty('mnetProfileDefinitions')
    expect(schema).toHaveProperty('mnetNetworkProfileStates')
    expect(schema).toHaveProperty('mnetProfileTransitions')
    expect(schema).toHaveProperty('mnetSuspendedOperations')

    expect(migration).toContain('create table if not exists mnet_profile_definitions')
    expect(migration).toContain('create table if not exists mnet_network_profile_states')
    expect(migration).toContain('create table if not exists mnet_profile_transitions')
    expect(migration).toContain('create table if not exists mnet_suspended_operations')
    expect(migration).toContain(
      'create unique index if not exists mnet_profile_definitions_profile_version_unique'
    )
  })

  it('matches required table column shapes and SQL types', () => {
    const profileDefinitionColumns = getTableColumns(schema.mnetProfileDefinitions)
    expect(Object.keys(profileDefinitionColumns)).toEqual([
      'id',
      'profileVersion',
      'region',
      'schemaVersion',
      'definition',
      'status',
      'createdAt',
      'updatedAt'
    ])
    expect(profileDefinitionColumns.id.getSQLType()).toBe('text')
    expect(profileDefinitionColumns.definition.getSQLType()).toBe('jsonb')
    expect(profileDefinitionColumns.createdAt.getSQLType()).toBe('timestamp with time zone')

    const networkStateColumns = getTableColumns(schema.mnetNetworkProfileStates)
    expect(Object.keys(networkStateColumns)).toEqual([
      'networkId',
      'profileVersion',
      'status',
      'enabledBy',
      'policyDecisionId',
      'correlationId',
      'appliedAt',
      'disabledAt',
      'lastError',
      'updatedAt'
    ])
    expect(networkStateColumns.networkId.getSQLType()).toBe('text')
    expect(networkStateColumns.appliedAt.getSQLType()).toBe('timestamp with time zone')
    expect(networkStateColumns.lastError.getSQLType()).toBe('text')

    const transitionColumns = getTableColumns(schema.mnetProfileTransitions)
    expect(Object.keys(transitionColumns)).toEqual([
      'id',
      'networkId',
      'fromProfileVersion',
      'toProfileVersion',
      'fromStatus',
      'toStatus',
      'actor',
      'reason',
      'policyDecisionId',
      'correlationId',
      'createdAt'
    ])
    expect(transitionColumns.createdAt.getSQLType()).toBe('timestamp with time zone')

    const suspendedOperationColumns = getTableColumns(schema.mnetSuspendedOperations)
    expect(Object.keys(suspendedOperationColumns)).toEqual([
      'id',
      'policyDecisionId',
      'action',
      'networkId',
      'fromProfileVersion',
      'toProfileVersion',
      'requestedBy',
      'reason',
      'correlationId',
      'idempotencyKey',
      'status',
      'expiresAt',
      'createdAt',
      'resumedAt',
      'terminalReason'
    ])
    expect(suspendedOperationColumns.expiresAt.getSQLType()).toBe('timestamp with time zone')
    expect(suspendedOperationColumns.idempotencyKey.getSQLType()).toBe('text')
  })

  it('seeds default M-Net profiles and profile permissions', async () => {
    const seed = await Bun.file('packages/db/src/seed.ts').text()

    expect(seed).toContain("'m-net@0.3.0'")
    expect(seed).toContain("'m-net-cn@0.3.0'")
    expect(seed).toContain('controlPlaneOnly: false')
    expect(seed).toContain('realNetBirdSidecar: true')

    expect(seed).toContain(
      "['network:profile-read', 'read network regional profile definitions and state']"
    )
    expect(seed).toContain(
      "['network:profile-enable', 'enable network regional profile for a network']"
    )
    expect(seed).toContain(
      "['network:profile-disable', 'disable network regional profile for a network']"
    )

    expect(seed).toMatch(/operator:\s*\[\s*'core:read'/)
    expect(seed).toContain("'network:profile-read'")
    expect(seed).toContain("'network:profile-enable'")
    expect(seed).toContain("'network:profile-disable'")
    expect(seed).toMatch(/admin:\s*\[\s*'core:read'/)
    expect(seed).toContain("'security-admin': [")
  })
})
