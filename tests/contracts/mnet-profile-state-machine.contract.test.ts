import { describe, expect, it } from 'bun:test'
import {
  canDisable,
  canRequestEnable,
  canResume,
  nextProfileState,
  type ProfileAction,
  type ProfileState
} from '@m-net/profile/profile-state-machine.ts'
import type { ProfileTransitionRecord } from '@m-net/profile/profile-store.ts'
import { applyProfileTransition, foldProfileTransition } from '@m-net/profile/profile-transition.ts'
import type { ProfileStore } from '@m-net/profile/profile-workflow-types.ts'

/** 捕获 store 写入的假实现，用于断言 chokepoint 发出的状态事实。 */
function createRecordingProfileStore(initial: { profileVersion: string; status: ProfileState }): {
  store: ProfileStore
  states: Array<{ profileVersion: string; status: string }>
  transitions: ProfileTransitionRecord[]
} {
  const states: Array<{ profileVersion: string; status: string }> = []
  const transitions: ProfileTransitionRecord[] = []
  const store: ProfileStore = {
    getDefinitions: async () => [],
    getDefinition: async () => null,
    getNetworkState: async () => ({
      networkId: 'net-1',
      profileVersion: initial.profileVersion,
      status: initial.status,
      updatedAt: new Date().toISOString()
    }),
    setNetworkState: async (_networkId, state) => {
      states.push(state)
    },
    listNetworkStates: async () => [],
    recordTransition: async record => {
      transitions.push(record)
    }
  }
  return { store, states, transitions }
}

describe('M-Net profile state machine', () => {
  const allStates: ProfileState[] = ['disabled', 'enabling', 'enabled', 'disabling', 'failed']

  // ---- nextProfileState 主迁移路径 ----

  it('disabled + enable_request → enabling', () => {
    expect(nextProfileState('disabled', 'enable_request')).toBe('enabling')
  })

  it('enabling + enable_success → enabled', () => {
    expect(nextProfileState('enabling', 'enable_success')).toBe('enabled')
  })

  it('enabled + disable_request → disabling', () => {
    expect(nextProfileState('enabled', 'disable_request')).toBe('disabling')
  })

  it('disabling + disable_success → disabled', () => {
    expect(nextProfileState('disabling', 'disable_success')).toBe('disabled')
  })

  // ---- 故障迁移路径 ----

  it('enabling + enable_fail → failed', () => {
    expect(nextProfileState('enabling', 'enable_fail')).toBe('failed')
  })

  it('disabling + disable_fail → failed', () => {
    expect(nextProfileState('disabling', 'disable_fail')).toBe('failed')
  })

  // ---- failed 状态恢复路径 ----

  it('failed + disable_request → disabling', () => {
    expect(nextProfileState('failed', 'disable_request')).toBe('disabling')
  })

  it('failed + enable_request → enabling', () => {
    expect(nextProfileState('failed', 'enable_request')).toBe('enabling')
  })

  // ---- 非法迁移不作处理 ----

  it('disabled + enable_success → disabled (no-op)', () => {
    expect(nextProfileState('disabled', 'enable_success')).toBe('disabled')
  })

  it('disabled + disable_request → disabled (no-op)', () => {
    expect(nextProfileState('disabled', 'disable_request')).toBe('disabled')
  })

  it('enabling + disable_request → enabling (no-op)', () => {
    expect(nextProfileState('enabling', 'disable_request')).toBe('enabling')
  })

  it('enabled + enable_request → enabled (no-op)', () => {
    expect(nextProfileState('enabled', 'enable_request')).toBe('enabled')
  })

  it('disabling + enable_request → disabling (no-op)', () => {
    expect(nextProfileState('disabling', 'enable_request')).toBe('disabling')
  })

  // ---- 纯函数特性：相同输入相同输出 ----

  it('nextProfileState is pure: same input always returns same output', () => {
    for (let i = 0; i < 5; i++) {
      expect(nextProfileState('disabled', 'enable_request')).toBe('enabling')
      expect(nextProfileState('enabling', 'enable_success')).toBe('enabled')
      expect(nextProfileState('enabled', 'disable_request')).toBe('disabling')
      expect(nextProfileState('disabling', 'disable_success')).toBe('disabled')
    }
  })

  // ---- canRequestEnable ----

  it('canRequestEnable: true for disabled or failed (failed → enabling recovery path)', () => {
    for (const state of allStates) {
      if (state === 'disabled' || state === 'failed') {
        expect(canRequestEnable(state)).toBe(true)
      } else {
        expect(canRequestEnable(state)).toBe(false)
      }
    }
  })

  // ---- canDisable ----

  it('canDisable: true for enabled or failed', () => {
    for (const state of allStates) {
      if (state === 'enabled' || state === 'failed') {
        expect(canDisable(state)).toBe(true)
      } else {
        expect(canDisable(state)).toBe(false)
      }
    }
  })

  // ---- canResume ----

  it('canResume: only true for enabling', () => {
    for (const state of allStates) {
      if (state === 'enabling') {
        expect(canResume(state)).toBe(true)
      } else {
        expect(canResume(state)).toBe(false)
      }
    }
  })

  // ---- 完整状态机闭环测试 ----

  it('full lifecycle: disabled → enabling → enabled → disabling → disabled', () => {
    let state: ProfileState = 'disabled'

    state = nextProfileState(state, 'enable_request')
    expect(state).toBe('enabling')

    state = nextProfileState(state, 'enable_success')
    expect(state).toBe('enabled')

    state = nextProfileState(state, 'disable_request')
    expect(state).toBe('disabling')

    state = nextProfileState(state, 'disable_success')
    expect(state).toBe('disabled')
  })

  it('failure recovery: disabled → enabling → failed → disable_request → disabling → disabled', () => {
    let state: ProfileState = 'disabled'

    state = nextProfileState(state, 'enable_request')
    expect(state).toBe('enabling')

    state = nextProfileState(state, 'enable_fail')
    expect(state).toBe('failed')

    state = nextProfileState(state, 'disable_request')
    expect(state).toBe('disabling')

    state = nextProfileState(state, 'disable_success')
    expect(state).toBe('disabled')
  })

  it('failure recovery: disabled → enabling → failed → enable_request → enabling → enabled', () => {
    let state: ProfileState = 'disabled'

    state = nextProfileState(state, 'enable_request')
    expect(state).toBe('enabling')

    state = nextProfileState(state, 'enable_fail')
    expect(state).toBe('failed')

    state = nextProfileState(state, 'enable_request')
    expect(state).toBe('enabling')

    state = nextProfileState(state, 'enable_success')
    expect(state).toBe('enabled')
  })

  // ---- 空状态数量检查 ----

  it('ProfileAction is a union of 6 exact strings', () => {
    const actions: ProfileAction[] = [
      'enable_request',
      'enable_success',
      'enable_fail',
      'disable_request',
      'disable_success',
      'disable_fail'
    ]
    expect(actions).toHaveLength(6)
  })

  it('ProfileState is a union of 5 exact strings', () => {
    expect(allStates).toHaveLength(5)
  })
})

describe('M-Net profile transition chokepoint (every table row through applyProfileTransition)', () => {
  const baseState = (status: ProfileState) => ({
    networkId: 'net-1',
    profileVersion: 'm-net@0.3.0',
    status,
    updatedAt: new Date().toISOString()
  })

  const tableRows: Array<{
    name: string
    from: ProfileState
    action: ProfileAction
    to: ProfileState
  }> = [
    {
      name: 'enable_request from disabled',
      from: 'disabled',
      action: 'enable_request',
      to: 'enabling'
    },
    {
      name: 'enable_success from enabling',
      from: 'enabling',
      action: 'enable_success',
      to: 'enabled'
    },
    { name: 'enable_fail from enabling', from: 'enabling', action: 'enable_fail', to: 'failed' },
    {
      name: 'disable_request from enabled',
      from: 'enabled',
      action: 'disable_request',
      to: 'disabling'
    },
    {
      name: 'disable_success from disabling',
      from: 'disabling',
      action: 'disable_success',
      to: 'disabled'
    },
    {
      name: 'disable_fail from disabling',
      from: 'disabling',
      action: 'disable_fail',
      to: 'failed'
    },
    {
      name: 'enable_request from failed (recovery)',
      from: 'failed',
      action: 'enable_request',
      to: 'enabling'
    },
    {
      name: 'disable_request from failed (recovery)',
      from: 'failed',
      action: 'disable_request',
      to: 'disabling'
    }
  ]

  for (const row of tableRows) {
    it(`applyProfileTransition: ${row.name} → ${row.to}`, async () => {
      const { store, states, transitions } = createRecordingProfileStore({
        profileVersion: 'm-net@0.3.0',
        status: row.from
      })
      const applied = await applyProfileTransition(store, {
        networkId: 'net-1',
        fromState: baseState(row.from),
        actions: [row.action],
        stateProfileVersion: 'm-net-cn@0.3.0',
        actor: 'operator',
        reason: 'row coverage',
        policyDecisionId: 'decision-1',
        correlationId: 'correlation-1'
      })

      expect(applied.toStatus).toBe(row.to)
      expect(states).toEqual([{ profileVersion: 'm-net-cn@0.3.0', status: row.to }])
      expect(transitions).toHaveLength(1)
      expect(transitions[0]).toMatchObject({
        networkId: 'net-1',
        fromVersion: 'm-net@0.3.0',
        toVersion: 'm-net-cn@0.3.0',
        fromStatus: row.from,
        toStatus: row.to,
        actor: 'operator',
        reason: 'row coverage',
        policyDecisionId: 'decision-1',
        correlationId: 'correlation-1'
      })
    })
  }

  it('applyProfileTransition: non-legal (no-op) rows keep current state', async () => {
    const allStates: ProfileState[] = ['disabled', 'enabling', 'enabled', 'disabling', 'failed']
    for (const from of allStates) {
      const action: ProfileAction = 'enable_success'
      if (from === 'enabling') continue
      const { store, states, transitions } = createRecordingProfileStore({
        profileVersion: 'm-net@0.3.0',
        status: from
      })
      const applied = await applyProfileTransition(store, {
        networkId: 'net-1',
        fromState: baseState(from),
        actions: [action],
        actor: 'operator',
        reason: 'no-op row'
      })
      expect(applied.toStatus).toBe(from)
      expect(states).toEqual([{ profileVersion: 'm-net@0.3.0', status: from }])
      expect(transitions[0]?.toStatus).toBe(from)
      // 未提供可选字段时迁移记录不携带 policyDecisionId / correlationId
      expect(transitions[0]).not.toHaveProperty('policyDecisionId')
      expect(transitions[0]).not.toHaveProperty('correlationId')
    }
  })

  it('applyProfileTransition: immediate disable folds request + success into one record', async () => {
    const { store, states, transitions } = createRecordingProfileStore({
      profileVersion: 'm-net-cn@0.3.0',
      status: 'enabled'
    })
    const applied = await applyProfileTransition(store, {
      networkId: 'net-1',
      fromState: baseState('enabled'),
      actions: ['disable_request', 'disable_success'],
      stateProfileVersion: 'm-net@0.3.0',
      actor: 'operator',
      reason: 'immediate disable'
    })
    expect(applied.toStatus).toBe('disabled')
    expect(foldProfileTransition('failed', ['disable_request', 'disable_success'])).toBe('disabled')
    expect(foldProfileTransition('disabled', ['enable_request', 'enable_success'])).toBe('enabled')
    expect(states).toEqual([{ profileVersion: 'm-net@0.3.0', status: 'disabled' }])
    expect(transitions[0]).toMatchObject({
      fromVersion: 'm-net@0.3.0',
      toVersion: 'm-net@0.3.0',
      fromStatus: 'enabled',
      toStatus: 'disabled'
    })
  })

  it('applyProfileTransition: pending request keeps current profileVersion in network state', async () => {
    const { store, states, transitions } = createRecordingProfileStore({
      profileVersion: 'm-net@0.3.0',
      status: 'disabled'
    })
    await applyProfileTransition(store, {
      networkId: 'net-1',
      fromState: baseState('disabled'),
      actions: ['enable_request'],
      transitionToVersion: 'm-net-cn@0.3.0',
      actor: 'operator',
      reason: 'pending enable'
    })
    expect(states).toEqual([{ profileVersion: 'm-net@0.3.0', status: 'enabling' }])
    expect(transitions[0]).toMatchObject({
      fromVersion: 'm-net@0.3.0',
      toVersion: 'm-net-cn@0.3.0',
      fromStatus: 'disabled',
      toStatus: 'enabling'
    })
  })
})
