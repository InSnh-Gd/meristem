import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/state', () => ({
  page: {
    params: {
      id: 'approval-1',
      profileVersion: 'm-net-cn@0.1.0'
    }
  }
}))

import ControlRoomPage from '../../src/routes/control-room/+page.svelte'
import BreakGlassPage from '../../src/routes/mnet/break-glass/+page.svelte'
import NetworkProfileDetailPage from '../../src/routes/network/profiles/[profileVersion]/+page.svelte'
import ApprovalDetailPage from '../../src/routes/policy/approvals/[id]/+page.svelte'
import { appState } from '../../src/lib/stores.svelte.ts'
import { installAppStateReset } from './_specs/app-state'
import {
  createApprovalDetailFixture,
  createBreakGlassCommandState,
  createControlRoomCommandState,
  createNetworkProfileDetailFixture,
  createOverviewFixture
} from './_specs/fixtures'

installAppStateReset()

describe('priority route runtime behavior', () => {
  it('mounts control-room with primary landmarks', () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()

    render(ControlRoomPage)

    expect(document.title).toContain('控制室概览 | Meristem')
    expect(screen.getByRole('heading', { name: '控制室概览' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '节点' })).toBeTruthy()
    expect(screen.getByText('运行 noop 任务')).toBeTruthy()
  })

  it('mounts approval detail with preview and command surfaces', () => {
    appState.selectedApproval = createApprovalDetailFixture()

    render(ApprovalDetailPage)

    expect(document.title).toContain('审批详情 | Meristem')
    expect(screen.getByLabelText('审批详情面板')).toBeTruthy()
    expect(screen.getByText('approval-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: '批准审批请求' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '拒绝审批请求' })).toBeTruthy()
  })

  it('mounts network profile detail with global controls and target selector', () => {
    appState.selectedProfile = createNetworkProfileDetailFixture()

    render(NetworkProfileDetailPage)

    expect(document.title).toContain('Profile 详情 | Meristem')
    expect(screen.getByLabelText('网络 Profile 详情面板')).toBeTruthy()
    expect(screen.getByText('CN profile')).toBeTruthy()
    expect(screen.getByLabelText('目标网络')).toBeTruthy()
    expect(
      screen.getAllByText('配置变更仅影响控制平面，运行时数据面不受影响').length
    ).toBeGreaterThan(0)
  })

  it('mounts break-glass with risk warning and command region', () => {
    appState.commandState = createBreakGlassCommandState()

    render(BreakGlassPage)

    expect(document.title).toContain('紧急预案 (Break-glass) | Meristem')
    expect(screen.getByText('⚠ 警告：破坏性操作')).toBeTruthy()
    expect(screen.getByRole('button', { name: '验证紧急操作资格' })).toBeTruthy()
    expect(screen.getByText('请在面板中验证紧急操作')).toBeTruthy()
  })
})
