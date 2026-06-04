import { describe, expect, it } from 'bun:test'
import {
  canDisable,
  canRequestEnable,
  canResume,
  nextProfileState,
  type ProfileAction,
  type ProfileState
} from '../../services/m-net/src/profile-state-machine.ts'

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
