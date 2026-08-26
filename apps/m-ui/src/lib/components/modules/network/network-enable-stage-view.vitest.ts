import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { NetworkRuntimeStateData, NetworkRuntimeTruth } from '$lib/types.ts'
import NetworkEnableStageView from './NetworkEnableStageView.svelte'

type ProfileState = NetworkRuntimeTruth['profile']
type CommandEligibility = NetworkRuntimeStateData['policyEligibility']['commands'][number]

/** 构造启用展示态；默认 enabled + read-model 来源，测试按需覆写。 */
function profileState(overrides: Partial<ProfileState> = {}): ProfileState {
  return {
    state: 'enabled',
    reason: 'Profile 已成功启用',
    stateSource: { sourceType: 'read-model', sourceId: 'mnet:profile' },
    ...overrides
  }
}

/** 构造启用命令的策略资格展示态。 */
function enableCommand(overrides: Partial<CommandEligibility> = {}): CommandEligibility {
  return {
    commandId: 'network.profile.enable.execute',
    label: '启用 Profile',
    action: 'network:profile-enable',
    resource: 'network:net-direct-001',
    requiredPermissions: ['network:profile-enable'],
    requiresPolicy: true,
    requiresAudit: true,
    state: 'enabled',
    summary: 'profile enable is eligible',
    ...overrides
  }
}

describe('NetworkEnableStageView seam', () => {
  it('renders the profile state, reason, source badge and eligible command row', () => {
    render(NetworkEnableStageView, {
      props: {
        profileState: profileState(),
        enableCommand: enableCommand(),
        loading: false,
        errorMessage: null,
        onRetry: vi.fn()
      }
    })

    expect(screen.getByTestId('enable-grid')).toBeTruthy()
    expect(screen.getByText('Profile 启用状态')).toBeTruthy()
    expect(screen.getByTestId('profile-enable-state').textContent).toContain('已启用')
    expect(screen.getByTestId('profile-enable-reason').textContent).toContain('Profile 已成功启用')
    expect(screen.getByText('读模型')).toBeTruthy()
    expect(screen.getByTestId('profile-enable-eligibility').textContent).toContain('可执行')
  })

  it('renders the disabled eligibility reason without deciding authorization itself', () => {
    render(NetworkEnableStageView, {
      props: {
        profileState: profileState({ state: 'disabled', reason: undefined }),
        enableCommand: enableCommand({
          state: 'disabled',
          disabledReason: {
            code: 'missing_permission',
            message: '缺少权限：network:profile-enable',
            missingPermission: 'network:profile-enable'
          }
        }),
        loading: false,
        errorMessage: null,
        onRetry: vi.fn()
      }
    })

    expect(screen.getByTestId('profile-enable-state').textContent).toContain('已禁用')
    expect(screen.queryByTestId('profile-enable-reason')).toBeNull()
    expect(screen.getByTestId('profile-enable-eligibility').textContent).toContain('已禁用')
    expect(screen.getByTestId('profile-enable-disabled-reason').textContent).toContain(
      '缺少权限：network:profile-enable'
    )
  })

  it('renders degraded state and hides the eligibility row when no command is supplied', () => {
    render(NetworkEnableStageView, {
      props: {
        profileState: profileState({ state: 'degraded', reason: '需先完成 Profile 迁移' }),
        enableCommand: null,
        loading: false,
        errorMessage: null,
        onRetry: vi.fn()
      }
    })

    expect(screen.getByTestId('profile-enable-state').textContent).toContain('已降级')
    expect(screen.queryByTestId('profile-enable-eligibility')).toBeNull()
  })

  it('renders the loading line before any profile state is available', () => {
    render(NetworkEnableStageView, {
      props: {
        profileState: null,
        enableCommand: null,
        loading: true,
        errorMessage: null,
        onRetry: vi.fn()
      }
    })

    expect(screen.getByText('正在加载运行态...')).toBeTruthy()
    expect(screen.queryByTestId('enable-grid')).toBeNull()
  })

  it('renders a blocking alert and invokes the retry callback owned by the route', async () => {
    const onRetry = vi.fn()

    render(NetworkEnableStageView, {
      props: {
        profileState: profileState(),
        enableCommand: enableCommand(),
        loading: false,
        errorMessage: '运行态聚合不可用',
        onRetry
      }
    })

    expect(screen.queryByTestId('enable-grid')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('运行态聚合不可用')

    const retryButton = screen.getByRole('button', { name: '重试' })
    retryButton.click()
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
