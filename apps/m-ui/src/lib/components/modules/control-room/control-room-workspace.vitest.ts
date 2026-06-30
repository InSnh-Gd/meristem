import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import { appState } from '$lib/stores.svelte.ts'
import { installAppStateReset } from '../../../../../tests/runtime/_specs/app-state'
import {
  createControlRoomCommandState,
  createOverviewFixture,
  createTaskResultFixture
} from '../../../../../tests/runtime/_specs/fixtures'
import ControlRoomWorkspace from './ControlRoomWorkspace.svelte'

installAppStateReset()

describe('ControlRoomWorkspace seam', () => {
  it('renders rewritten workbench landmarks correctly', () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()

    render(ControlRoomWorkspace)

    expect(document.title).toContain('控制室概览 | Meristem')
    expect(screen.getByRole('heading', { name: '系统状态' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '节点' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '命令中心' })).toBeTruthy()
    expect(screen.getByText('运行 noop 任务')).toBeTruthy()
  })

  it('routes command execution result and execution error into the quick-actions module', () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()
    appState.taskResult = createTaskResultFixture()
    appState.commandExecutionError = '操作执行失败 (policy_denied)'

    render(ControlRoomWorkspace)

    const quickActions = screen.getByTestId('control-room-quick-actions')
    expect(quickActions.textContent).toContain('命令中心')
    expect(quickActions.textContent).toContain('task-1')
    expect(quickActions.textContent).toContain('decision-1')
    expect(quickActions.textContent).toContain('corr-1')
    expect(quickActions.textContent).toContain('操作执行失败 (policy_denied)')
  })
})
