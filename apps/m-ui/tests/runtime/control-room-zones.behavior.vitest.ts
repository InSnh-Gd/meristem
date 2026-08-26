import { render, screen, within } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import { appState } from '../../src/lib/stores.svelte.ts'
import ControlRoomWorkspace from '../../src/lib/components/modules/control-room/ControlRoomWorkspace.svelte'
import { installAppStateReset } from './_specs/app-state'
import {
  createControlRoomCommandState,
  createOverviewFixture,
  createTaskResultFixture
} from './_specs/fixtures'

installAppStateReset()

/**
 * 控制室工作台各 zone 的渲染特征测试（characterization test）。
 *
 * 目的：在把 ControlRoomWorkspace 拆分为 zone 子组件之前，先把当前渲染结果
 * 钉死在断言里。测试覆盖此前没有断言保护的区域：账本表头、功能域服务表格、
 * 已选上下文检查器、以及未授权预览分支。拆分后这些断言必须逐字通过，
 * 以此证明结构重组没有改变渲染输出。
 */
function renderAuthorizedWorkspace() {
  appState.overview = createOverviewFixture()
  appState.selectedNodeId = 'leaf-1'
  appState.commandState = createControlRoomCommandState()
  appState.taskResult = createTaskResultFixture()

  render(ControlRoomWorkspace)
}

describe('control-room zone rendering characterization', () => {
  it('renders the event and audit ledger table with its full column header row', () => {
    renderAuthorizedWorkspace()

    const activityPanel = screen.getByTestId('control-room-recent-activity-panel')
    const ledgerHeaders = within(activityPanel).getAllByRole('columnheader')
    expect(ledgerHeaders.map(header => header.textContent)).toEqual([
      'timestamp',
      'event',
      'actor',
      'target',
      'source',
      'policyDecisionId',
      'correlationId',
      'outcome'
    ])

    // Timeline 与 Audit 两个来源都要出现在同一账本里。
    expect(within(activityPanel).getByText('leaf node joined test-network')).toBeTruthy()
    expect(within(activityPanel).getByText('Timeline')).toBeTruthy()
    expect(within(activityPanel).getByText('task.submit')).toBeTruthy()
    expect(within(activityPanel).getByText('Task')).toBeTruthy()
    expect(within(activityPanel).getByText('allowed')).toBeTruthy()
    expect(within(activityPanel).getByText('logged')).toBeTruthy()
    expect(within(activityPanel).getByText('node/leaf-1')).toBeTruthy()
    expect(within(activityPanel).getByText('node:leaf-1')).toBeTruthy()
  })

  it('renders the capability domain service table with endpoint and state source columns', () => {
    renderAuthorizedWorkspace()

    expect(screen.getByRole('heading', { name: '功能域服务状态' })).toBeTruthy()

    const metricsPanel = screen.getByTestId('control-room-metrics-panel')
    // 账本表格与服务表格同处 metrics 区域，服务表格是第二张。
    expect(within(metricsPanel).getAllByRole('table').length).toBe(2)

    // 服务表格的表头顺序与 endpoint 派生结果都属于当前渲染契约。
    expect(metricsPanel.textContent).toContain('endpoint / port')
    expect(metricsPanel.textContent).toContain('last check')
    expect(metricsPanel.textContent).toContain('uptime')
    expect(within(metricsPanel).getByText('mpolicy.internal:8082')).toBeTruthy()
    expect(within(metricsPanel).getByText('读模型')).toBeTruthy()
    expect(within(metricsPanel).getByText('m-policy')).toBeTruthy()
  })

  it('renders the selected context inspector with identity, node, policy, and trace sections', () => {
    renderAuthorizedWorkspace()

    const inspector = screen.getByLabelText('已选上下文')
    expect(within(inspector).getByRole('heading', { name: 'Leaf 1' })).toBeTruthy()
    expect(within(inspector).getByText('身份与权限')).toBeTruthy()
    expect(within(inspector).getByText('节点信息')).toBeTruthy()
    expect(within(inspector).getByText('策略上下文')).toBeTruthy()
    expect(within(inspector).getByText('跟踪上下文')).toBeTruthy()

    // 身份、节点、策略、跟踪四段的 key 行必须逐字保留。
    for (const key of [
      'nodeKind',
      'reachability',
      'permissions',
      'stateSource',
      'lastRefresh',
      'nodeId',
      'name',
      'mode',
      'status',
      'lastSeenAt',
      'version',
      'capabilities',
      'lastDecision',
      'policyDecisionId',
      'action',
      'decisionAt',
      'correlationId',
      'task.id',
      'task.status'
    ]) {
      expect(within(inspector).getByText(key)).toBeTruthy()
    }
    // actor 同时出现在身份段与策略段。
    expect(within(inspector).getAllByText('actor').length).toBe(2)

    expect(within(inspector).getByText('leaf')).toBeTruthy()
    expect(within(inspector).getByText('reachable')).toBeTruthy()
    expect(within(inspector).getByText('agent')).toBeTruthy()
    expect(within(inspector).getByText('task:submit')).toBeTruthy()
    expect(within(inspector).getByText('task-1')).toBeTruthy()
    expect(within(inspector).getByText('accepted')).toBeTruthy()
    expect(within(inspector).getByText('corr-1')).toBeTruthy()
    // node.status 既出现在头部徽章，也出现在节点信息段。
    expect(within(inspector).getAllByText('healthy').length).toBe(2)
  })

  it('renders the inspector empty state when no node is selected', () => {
    appState.overview = createOverviewFixture()
    appState.commandState = createControlRoomCommandState()

    render(ControlRoomWorkspace)

    const inspector = screen.getByLabelText('已选上下文')
    expect(within(inspector).getByRole('heading', { name: '未选择节点' })).toBeTruthy()
    expect(within(inspector).getByText('选择上方节点以查看上下文、策略与跟踪信息。')).toBeTruthy()
  })

  it('renders the unauthorized preview workbench when overview is absent', () => {
    appState.overview = null
    appState.loading = false

    render(ControlRoomWorkspace)

    const preview = screen.getByLabelText('未授权控制室预览')
    expect(within(preview).getByRole('heading', { name: '控制室总览' })).toBeTruthy()
    expect(
      within(preview).getByText(
        '输入操作者令牌后加载 Core、功能域服务、Leaf 节点、策略与审计状态。'
      )
    ).toBeTruthy()
    expect(within(preview).getByText('actor: 未授权')).toBeTruthy()
    expect(within(preview).getByText('core: gated')).toBeTruthy()

    // 预览摘要卡片：五张 gated 卡片标题与 gated 状态标记。
    for (const title of [
      'Core Health',
      'EventBus',
      'Leaf Nodes',
      'Policy Gate',
      'Audit Visibility'
    ]) {
      expect(within(preview).getByText(title)).toBeTruthy()
    }
    expect(within(preview).getAllByText('待加载').length).toBe(5)
    expect(within(preview).getAllByText('stateSource: gated').length).toBe(5)
    expect(within(preview).getAllByText('需要令牌').length).toBe(5)

    // 预览命令卡片保留标题、target、requirement 与未授权状态。
    expect(within(preview).getByText('执行上下文: gated')).toBeTruthy()
    for (const command of [
      '运行 noop 任务',
      '刷新 Leaf 状态',
      '查看 EventBus publish summary',
      '运行 重启任务'
    ]) {
      expect(within(preview).getByText(command, { exact: false })).toBeTruthy()
    }
    expect(within(preview).getAllByText('target: 需要令牌').length).toBe(4)
    expect(within(preview).getAllByText('状态: 未授权').length).toBe(4)
    expect(within(preview).getAllByText('requires: gated').length).toBe(4)

    // 预览账本与服务区域标题保留，计数显示为 0。
    expect(within(preview).getByRole('heading', { name: '事件与审计账本' })).toBeTruthy()
    expect(within(preview).getByRole('heading', { name: '功能域服务状态' })).toBeTruthy()
    expect(within(preview).getAllByText('0').length).toBe(2)

    // 预览检查器保留访问边界说明。
    const previewInspector = screen.getByLabelText('未授权上下文')
    expect(within(previewInspector).getByText('请输入操作者令牌以加载控制室概览。')).toBeTruthy()
    expect(within(previewInspector).getByText('访问边界')).toBeTruthy()
    expect(within(previewInspector).getByText('Bearer JWT')).toBeTruthy()
    expect(within(previewInspector).getByText('gated')).toBeTruthy()
  })
})
