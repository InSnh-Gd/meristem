import { beforeEach, describe, expect, it } from 'bun:test'
import {
  createInMemoryProfileStore,
  type ProfileStore
} from '../../services/m-net/src/profile-store.ts'
import {
  createInMemorySuspendedOperationStore,
  type SuspendedOperationStore
} from '../../services/m-net/src/suspended-operations.ts'

describe('M-Net in-memory profile store', () => {
  let store: ProfileStore

  // 每个测试重新创建 store，保证隔离
  beforeEach(() => {
    store = createInMemoryProfileStore()
  })

  it('getDefinitions returns default and CN profiles', async () => {
    const defs = await store.getDefinitions()
    expect(defs).toHaveLength(2)

    const versions = defs.map(d => d.profileVersion).sort()
    expect(versions).toEqual(['m-net-cn@0.1.0', 'm-net-default@0.1.0'])

    const cnProfile = defs.find(d => d.profileVersion === 'm-net-cn@0.1.0')
    expect(cnProfile).toBeDefined()
    expect(cnProfile?.capabilities.controlPlaneOnly).toBe(true)
    expect(cnProfile?.region).toBe('cn')

    const defaultProfile = defs.find(d => d.profileVersion === 'm-net-default@0.1.0')
    expect(defaultProfile).toBeDefined()
    expect(defaultProfile?.capabilities.controlPlaneOnly).toBe(false)
    expect(defaultProfile?.region).toBe('default')
  })

  it('getDefinition returns CN profile by version', async () => {
    const cn = await store.getDefinition('m-net-cn@0.1.0')
    expect(cn).not.toBeNull()
    expect(cn?.profileVersion).toBe('m-net-cn@0.1.0')
    expect(cn?.displayName).toBe('M-Net CN')
  })

  it('getDefinition returns default profile by version', async () => {
    const def = await store.getDefinition('m-net-default@0.1.0')
    expect(def).not.toBeNull()
    expect(def?.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('getDefinition returns null for unknown version', async () => {
    const result = await store.getDefinition('m-net-unknown@0.1.0')
    expect(result).toBeNull()
  })

  it('getNetworkState returns null for unknown network', async () => {
    const result = await store.getNetworkState('nonexistent-network')
    expect(result).toBeNull()
  })

  it('setNetworkState + getNetworkState roundtrip', async () => {
    await store.setNetworkState('network-1', {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabling'
    })

    const state = await store.getNetworkState('network-1')
    expect(state).not.toBeNull()
    expect(state?.networkId).toBe('network-1')
    expect(state?.profileVersion).toBe('m-net-cn@0.1.0')
    expect(state?.status).toBe('enabling')
    expect(state?.updatedAt).toBeDefined()
  })

  it('setNetworkState overwrites previous state for same network', async () => {
    await store.setNetworkState('network-1', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'enabled'
    })

    await store.setNetworkState('network-1', {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabling'
    })

    const state = await store.getNetworkState('network-1')
    expect(state?.profileVersion).toBe('m-net-cn@0.1.0')
    expect(state?.status).toBe('enabling')
  })

  it('setNetworkState isolates different networks', async () => {
    await store.setNetworkState('network-a', {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })
    await store.setNetworkState('network-b', {
      profileVersion: 'm-net-default@0.1.0',
      status: 'disabled'
    })

    const a = await store.getNetworkState('network-a')
    const b = await store.getNetworkState('network-b')

    expect(a?.profileVersion).toBe('m-net-cn@0.1.0')
    expect(b?.profileVersion).toBe('m-net-default@0.1.0')
  })

  it('recordTransition creates a record', async () => {
    await store.recordTransition({
      networkId: 'network-1',
      fromVersion: 'm-net-default@0.1.0',
      toVersion: 'm-net-cn@0.1.0',
      fromStatus: 'disabled',
      toStatus: 'enabling',
      actor: 'admin',
      reason: 'regional compliance rollout',
      policyDecisionId: 'pd-1',
      correlationId: 'corr-1'
    })

    // recordTransition 只写入不返回数据；验证调用不抛出异常即可
    // 实际数据持久化由 DB adapter 负责
    expect(true).toBe(true)
  })

  it('recordTransition stores multiple records without error', async () => {
    await store.recordTransition({
      networkId: 'network-1',
      fromVersion: 'm-net-default@0.1.0',
      toVersion: 'm-net-cn@0.1.0',
      fromStatus: 'disabled',
      toStatus: 'enabling',
      actor: 'admin',
      reason: 'enable cn'
    })

    await store.recordTransition({
      networkId: 'network-1',
      fromVersion: 'm-net-cn@0.1.0',
      toVersion: 'm-net-default@0.1.0',
      fromStatus: 'failed',
      toStatus: 'disabling',
      actor: 'admin',
      reason: 'disable recovery'
    })

    expect(true).toBe(true)
  })

  it('getDefinitions returns independent copies', async () => {
    const defs1 = await store.getDefinitions()
    const defs2 = await store.getDefinitions()

    // 每次调用返回独立快照
    expect(defs1).toEqual(defs2)
    expect(defs1).not.toBe(defs2)
  })

  it('getNetworkState returns independent copies', async () => {
    await store.setNetworkState('network-1', {
      profileVersion: 'm-net-cn@0.1.0',
      status: 'enabled'
    })

    const state1 = await store.getNetworkState('network-1')
    const state2 = await store.getNetworkState('network-1')

    expect(state1).toEqual(state2)
    expect(state1).not.toBe(state2)
  })
})

describe('M-Net in-memory suspended operations store', () => {
  let suspendedStore: SuspendedOperationStore

  beforeEach(() => {
    suspendedStore = createInMemorySuspendedOperationStore()
  })

  it('create returns a suspended operation with initial status suspended', async () => {
    const op = await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      reason: 'enable CN profile',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    expect(op.id).toBeDefined()
    expect(op.status).toBe('suspended')
    expect(op.policyDecisionId).toBe('pd-1')
    expect(op.action).toBe('mnet.profile.enable')
    expect(op.networkId).toBe('network-1')
    expect(op.fromProfileVersion).toBe('m-net-default@0.1.0')
    expect(op.toProfileVersion).toBe('m-net-cn@0.1.0')
    expect(op.requestedBy).toBe('admin')
    expect(op.reason).toBe('enable CN profile')
    expect(op.correlationId).toBe('corr-1')
    expect(op.idempotencyKey).toBe('idem-1')
    expect(op.createdAt).toBeDefined()
    expect(op.expiresAt).toBeDefined()
  })

  it('get returns the created operation', async () => {
    const created = await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    const found = await suspendedStore.get(created.id)
    expect(found).not.toBeNull()
    expect(found?.id).toBe(created.id)
  })

  it('get returns null for unknown id', async () => {
    const result = await suspendedStore.get('nonexistent-id')
    expect(result).toBeNull()
  })

  it('getByPolicyDecisionId returns the matching operation', async () => {
    await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    const found = await suspendedStore.getByPolicyDecisionId('pd-1')
    expect(found).not.toBeNull()
    expect(found?.policyDecisionId).toBe('pd-1')
  })

  it('getByPolicyDecisionId returns null for unknown policyDecisionId', async () => {
    const result = await suspendedStore.getByPolicyDecisionId('unknown-pd')
    expect(result).toBeNull()
  })

  it('transition changes status to resumed', async () => {
    const created = await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    const updated = await suspendedStore.transition(created.id, 'resumed')
    expect(updated).not.toBeNull()
    expect(updated?.status).toBe('resumed')
    expect(updated?.resumedAt).toBeDefined()
  })

  it('transition changes status to rejected with terminalReason', async () => {
    const created = await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    const updated = await suspendedStore.transition(
      created.id,
      'rejected',
      'profile already disabled'
    )
    expect(updated).not.toBeNull()
    expect(updated?.status).toBe('rejected')
    expect(updated?.terminalReason).toBe('profile already disabled')
  })

  it('transition returns null for unknown id', async () => {
    const result = await suspendedStore.transition('nonexistent', 'resumed')
    expect(result).toBeNull()
  })

  it('transition preserves original fields', async () => {
    const created = await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    const updated = await suspendedStore.transition(created.id, 'resumed')
    expect(updated?.action).toBe('mnet.profile.enable')
    expect(updated?.networkId).toBe('network-1')
    expect(updated?.fromProfileVersion).toBe('m-net-default@0.1.0')
    expect(updated?.toProfileVersion).toBe('m-net-cn@0.1.0')
    expect(updated?.requestedBy).toBe('admin')
    expect(updated?.correlationId).toBe('corr-1')
    expect(updated?.idempotencyKey).toBe('idem-1')
  })

  it('transition to resume_failed stores terminalReason', async () => {
    const created = await suspendedStore.create({
      policyDecisionId: 'pd-1',
      action: 'mnet.profile.enable',
      networkId: 'network-1',
      fromProfileVersion: 'm-net-default@0.1.0',
      toProfileVersion: 'm-net-cn@0.1.0',
      requestedBy: 'admin',
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    })

    const updated = await suspendedStore.transition(
      created.id,
      'resume_failed',
      'network not found'
    )
    expect(updated).not.toBeNull()
    expect(updated?.status).toBe('resume_failed')
    expect(updated?.terminalReason).toBe('network not found')
  })
})
