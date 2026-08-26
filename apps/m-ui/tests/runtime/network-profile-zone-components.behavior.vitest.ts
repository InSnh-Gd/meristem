import { fireEvent, render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import NetworkProfileCommandWellZone from '../../src/lib/components/modules/network/NetworkProfileCommandWellZone.svelte'
import NetworkProfileGatedPreview from '../../src/lib/components/modules/network/NetworkProfileGatedPreview.svelte'
import NetworkProfileTargetSelectorZone from '../../src/lib/components/modules/network/NetworkProfileTargetSelectorZone.svelte'
import type { NetworkListResponseData, ProfileCommandResult } from '../../src/lib/types.ts'

/**
 * Profile 详情 zone 子组件的直接契约测试。
 *
 * 每个 zone 以显式 props 独立渲染，不经过父组件、不依赖 store，
 * 验证新提取的组件缝（seam）独立契约正确性。
 */
describe('NetworkProfileTargetSelectorZone', () => {
  const fixtureNetworks: NetworkListResponseData['networks'] = [
    {
      id: 'net-001',
      name: '生产网络',
      profileVersion: 'm-net@0.3.0',
      status: 'active',
      createdAt: '2026-08-01T00:00:00Z',
      memberCount: 5
    },
    {
      id: 'net-002',
      name: '测试网络',
      profileVersion: 'm-net-cn@0.3.0',
      status: 'active',
      createdAt: '2026-08-02T00:00:00Z',
      memberCount: 2
    }
  ]

  it('renders target network selector options from props', () => {
    render(NetworkProfileTargetSelectorZone, {
      props: {
        networks: fixtureNetworks,
        selectedNetworkId: 'net-001'
      }
    })

    expect(screen.getByRole('heading', { name: '选择 Profile 命令目标' })).toBeTruthy()
    expect(screen.getByLabelText('目标网络')).toBeTruthy()
    expect(screen.getByText('生产网络 / net-001')).toBeTruthy()
    expect(screen.getByText('测试网络 / net-002')).toBeTruthy()
  })

  it('renders loading and error states appropriately', () => {
    const { rerender } = render(NetworkProfileTargetSelectorZone, {
      props: {
        networks: [],
        networksLoading: true
      }
    })

    expect(screen.getByText('正在加载目标网络。')).toBeTruthy()
    const select = screen.getByLabelText('目标网络') as HTMLSelectElement
    expect(select.disabled).toBe(true)

    rerender({
      networks: [],
      networksLoading: false,
      networksError: '网络加载超时'
    })

    expect(screen.getByText('网络加载超时')).toBeTruthy()
  })

  it('renders empty message when no networks are available', () => {
    render(NetworkProfileTargetSelectorZone, {
      props: {
        networks: [],
        networksLoading: false,
        networksError: null
      }
    })

    expect(screen.getByText('暂无可选目标网络。')).toBeTruthy()
  })
})

describe('NetworkProfileCommandWellZone', () => {
  const baseProps = {
    selectedNetworkId: '',
    selectedNetworkName: null,
    pendingProfileCommand: null,
    commandRunning: false,
    commandError: null,
    commandResult: null,
    onRequestCommand: vi.fn(),
    onConfirmCommand: vi.fn(),
    onCancelCommand: vi.fn()
  }

  it('blocks execution when target network is not selected', () => {
    render(NetworkProfileCommandWellZone, { props: baseProps })

    const zone = within(screen.getByLabelText('Profile CommandWell'))
    expect(zone.getByTestId('profile-command-disabled-reason').textContent).toContain(
      '请先选择目标网络'
    )
    expect(zone.queryByRole('button', { name: '执行' })).toBeNull()
  })

  it('renders execute buttons when a target network is selected', async () => {
    const onRequestCommand = vi.fn()
    render(NetworkProfileCommandWellZone, {
      props: {
        ...baseProps,
        selectedNetworkId: 'net-001',
        selectedNetworkName: '主网络',
        onRequestCommand
      }
    })

    const zone = within(screen.getByLabelText('Profile CommandWell'))
    expect(zone.getByText('当前目标：')).toBeTruthy()
    expect(zone.getByText('主网络')).toBeTruthy()

    const executeButtons = zone.getAllByRole('button', { name: '执行' })
    expect(executeButtons.length).toBe(2)

    await fireEvent.click(executeButtons[0])
    expect(onRequestCommand).toHaveBeenCalledWith('enable')
  })

  it('renders confirmation view and invokes confirm/cancel callbacks', async () => {
    const onConfirmCommand = vi.fn()
    const onCancelCommand = vi.fn()

    render(NetworkProfileCommandWellZone, {
      props: {
        ...baseProps,
        selectedNetworkId: 'net-001',
        selectedNetworkName: '主网络',
        pendingProfileCommand: 'enable',
        onConfirmCommand,
        onCancelCommand
      }
    })

    const zone = within(screen.getByLabelText('Profile CommandWell'))
    expect(zone.getByText('状态: 需要确认')).toBeTruthy()

    const confirmBtn = zone.getByRole('button', { name: '确认执行' })
    const cancelBtn = zone.getByRole('button', { name: '取消' })

    await fireEvent.click(confirmBtn)
    expect(onConfirmCommand).toHaveBeenCalledTimes(1)

    await fireEvent.click(cancelBtn)
    expect(onCancelCommand).toHaveBeenCalledTimes(1)
  })

  it('renders structured command result and envelope view', () => {
    const fixtureResult: ProfileCommandResult = {
      status: 'pending_approval',
      correlationId: 'corr-xyz-123',
      operationId: 'op-456',
      approvalId: 'appr-789',
      profileVersion: 'm-net-cn@0.3.0'
    }

    render(NetworkProfileCommandWellZone, {
      props: {
        ...baseProps,
        selectedNetworkId: 'net-001',
        commandResult: fixtureResult
      }
    })

    const zone = within(screen.getByLabelText('Profile CommandWell'))
    expect(zone.getByText('corr-xyz-123')).toBeTruthy()
    expect(zone.getByText('op-456')).toBeTruthy()
    expect(zone.getByText('appr-789')).toBeTruthy()
  })
})

describe('NetworkProfileGatedPreview', () => {
  it('renders gated preview cards and context panel for unauthenticated state', () => {
    render(NetworkProfileGatedPreview, {
      props: {
        profileVersion: 'm-net-cn@0.3.0'
      }
    })

    expect(screen.getByRole('heading', { name: 'Profile 需要授权加载' })).toBeTruthy()
    expect(screen.getByText('目标 Profile')).toBeTruthy()
    expect(screen.getAllByText('m-net-cn@0.3.0').length).toBeGreaterThan(0)
    expect(screen.getByText('需要 Bearer JWT')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '未加载 Profile' })).toBeTruthy()
  })
})
