import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import { appState } from '../../src/lib/stores.svelte.ts'
import ControlRoomWorkspace from '../../src/lib/components/modules/control-room/ControlRoomWorkspace.svelte'
import { installAppStateReset } from './_specs/app-state'
import { createControlRoomCommandState, createOverviewFixture } from './_specs/fixtures'

installAppStateReset()

/**
 * 拆分后 CommandWell 确认门禁的宿主接线测试。
 *
 * 工作台承载 CommandWell 但不吸收其逻辑：命令资格与确认流程仍属 CommandWell
 * 与上游策略/审计边界。拆分只移动了周边 zone，因此这里验证宿主区域仍然把
 * onRequestConfirm / onConfirm 正确接到 appState，且高风险命令不会绕过确认。
 */
function renderWorkspaceWithCommand() {
  appState.overview = createOverviewFixture()
  appState.selectedNodeId = 'leaf-1'
  appState.commandState = createControlRoomCommandState()
  render(ControlRoomWorkspace)
}

describe('control-room CommandWell host gate after zone split', () => {
  it('keeps the CommandWell host region inside the workspace shell', () => {
    renderWorkspaceWithCommand()

    const quickActions = screen.getByTestId('control-room-quick-actions')
    expect(quickActions.textContent).toContain('命令中心')
    expect(screen.getByTestId('command-well')).toBeTruthy()
    // 执行上下文标注仍由宿主区域渲染，指向当前选中节点。
    expect(quickActions.textContent).toContain('执行上下文: Leaf 1')
  })

  it('routes the first click to confirmation instead of executing the command', async () => {
    const executeSpy = vi.spyOn(appState, 'executeGenericCommand')
    renderWorkspaceWithCommand()

    screen.getByTestId('command-btn').click()

    // 第一次点击只请求确认：高风险命令不得在未确认时执行。
    expect(appState.commandConfirming).toBe(true)
    expect(executeSpy).not.toHaveBeenCalled()
    executeSpy.mockRestore()
  })

  it('renders confirm and cancel actions once the host marks the command as confirming', () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()
    appState.commandConfirming = true

    render(ControlRoomWorkspace)

    expect(screen.getByTestId('command-confirm-btn')).toBeTruthy()
    expect(screen.getByTestId('command-cancel-btn')).toBeTruthy()
    // 未确认前不应存在直接执行入口。
    expect(screen.queryByTestId('command-btn')).toBeNull()
  })

  it('clears the confirming gate when the host cancel path runs', async () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()
    appState.commandConfirming = true

    render(ControlRoomWorkspace)
    screen.getByTestId('command-cancel-btn').click()

    expect(appState.commandConfirming).toBe(false)
  })

  it('does not render any command execution entry in the gated branch', () => {
    appState.overview = null
    appState.loading = false

    render(ControlRoomWorkspace)

    // 未授权分支只展示禁用预览卡片，不得出现可执行或可确认的入口。
    expect(screen.queryByTestId('command-btn')).toBeNull()
    expect(screen.queryByTestId('command-confirm-btn')).toBeNull()
    expect(screen.queryByTestId('command-well')).toBeNull()
    expect(screen.getAllByText('状态: 未授权').length).toBe(4)
  })
})
