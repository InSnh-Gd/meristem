import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import type { CommandState, RouteRegistry } from '../../src/lib/types.ts'

vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/control-room'),
    params: {},
    route: { id: '/control-room' },
    status: 200,
    error: null,
    data: {},
    form: null
  }
}))

import { appState } from '../../src/lib/stores.svelte.ts'
import ControlRoomVisualShellFixture from './_specs/control-room-visual-shell-fixture.svelte'
import { installAppStateReset } from './_specs/app-state'
import { createControlRoomCommandState, createOverviewFixture } from './_specs/fixtures'

installAppStateReset()

const visualShellHooks = {
  topAppBar: 'm-ui-top-app-bar',
  compactNavRail: 'm-ui-compact-nav-rail',
  metricsPanel: 'control-room-metrics-panel',
  operationsPanel: 'control-room-operations-panel',
  recentActivityPanel: 'control-room-recent-activity-panel',
  quickActionsPanel: 'control-room-quick-actions',
  commandWell: 'command-well'
} as const

const routeRegistry = {
  schemaVersion: 'sdui@0.2.0',
  routes: [
    {
      id: 'control-room.overview',
      title: '控制室概览',
      requiredPermissions: [],
      stateSources: ['authoritative', 'event', 'log', 'audit', 'read-model'],
      degradedState: { enabled: false, reason: '' },
      components: [
        { kind: 'RouteHeader', id: 'control-room-header' },
        { kind: 'NodeMap', id: 'control-room-node-map' },
        { kind: 'ServiceRegistryTable', id: 'control-room-service-registry' },
        { kind: 'TimelineStream', id: 'control-room-recent-activity' },
        { kind: 'CommandWellPanel', id: 'control-room-command-well' }
      ]
    },
    {
      id: 'services.index',
      title: '功能域服务',
      requiredPermissions: [],
      stateSources: ['authoritative', 'read-model'],
      degradedState: { enabled: false, reason: '' },
      components: [{ kind: 'ServiceRegistryTable', id: 'services-registry-table' }]
    }
  ]
} satisfies RouteRegistry

function renderControlRoomShell(commandState: CommandState = createControlRoomCommandState()) {
  appState.overview = createOverviewFixture()
  appState.selectedNodeId = 'leaf-1'
  appState.commandState = commandState
  appState.routes = routeRegistry

  render(ControlRoomVisualShellFixture)
}

describe('control-room visual shell contract', () => {
  it('renders the rewritten top chrome and compact navigation rail while keeping operator labels visible', () => {
    renderControlRoomShell()
    expect(screen.getByTestId(visualShellHooks.topAppBar)).toBeTruthy()
    expect(screen.getByText('Meristem v0.1.0')).toBeTruthy()
    expect(screen.getByText('BFF connected')).toBeTruthy()
    expect(screen.getByText('Core healthy')).toBeTruthy()
    expect(screen.getByText('控制室概览')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '控制室总览' })).toBeTruthy()
    expect(screen.getByText('控制面就绪')).toBeTruthy()
    expect(screen.getByRole('navigation')).toBeTruthy()
    expect(screen.getByRole('link', { name: '控制室概览' })).toBeTruthy()
    const missingHooks = [visualShellHooks.topAppBar, visualShellHooks.compactNavRail].filter(hook => !screen.queryByTestId(hook))
    expect(missingHooks).toEqual([])
  })

  it('renders the four-zone control-room workbench with metrics, operations, traceability, and command action modules', () => {
    renderControlRoomShell()
    expect(screen.getByRole('heading', { name: '系统状态' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '命令中心' })).toBeTruthy()
    expect(screen.getByText('运行 noop 任务')).toBeTruthy()
    expect(screen.getByText('stateSource: authoritative')).toBeTruthy()
    expect(screen.getAllByText('stateSource: read-model').length).toBeGreaterThan(0)
    const requiredHooks = [visualShellHooks.metricsPanel, visualShellHooks.operationsPanel, visualShellHooks.recentActivityPanel, visualShellHooks.quickActionsPanel]
    const missingHooks = requiredHooks.filter(hook => !screen.queryByTestId(hook))
    expect(missingHooks).toEqual([])
    expect(screen.getByTestId(visualShellHooks.metricsPanel).textContent).toMatch(/事件与审计账本|功能域服务状态/)
    expect(screen.getByTestId(visualShellHooks.operationsPanel).textContent).toMatch(/节点|Node inventory/)
    expect(screen.getByTestId(visualShellHooks.recentActivityPanel).textContent).toMatch(/事件与审计账本|leaf node joined test-network|task.submit/)
    expect(screen.getByTestId(visualShellHooks.quickActionsPanel).textContent).toContain('运行 noop 任务')
    expect(screen.getByTestId(visualShellHooks.quickActionsPanel).textContent).toContain('命令中心')
  })

  it('keeps disabled reasons and state sources visible inside the embedded command module', () => {
    renderControlRoomShell({
      state: 'disabled',
      disabledReason: '节点不可达',
      command: createControlRoomCommandState().command
    })
    expect(screen.getByText('运行 noop 任务')).toBeTruthy()
    expect(screen.getByTestId('command-disabled-reason').textContent).toContain('节点不可达')
    expect(screen.getByText('stateSource: authoritative')).toBeTruthy()
    expect(screen.getAllByText('stateSource: read-model').length).toBeGreaterThan(0)
    const quickActions = screen.getByTestId(visualShellHooks.quickActionsPanel)
    expect(quickActions.textContent).toContain('节点不可达')
    expect(quickActions.textContent).toContain('命令中心')
    expect(screen.getByTestId(visualShellHooks.commandWell)).toBeTruthy()
  })
})
