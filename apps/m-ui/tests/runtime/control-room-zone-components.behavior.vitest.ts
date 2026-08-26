import { render, screen, within } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import ControlRoomContextInspector from '../../src/lib/components/modules/control-room/ControlRoomContextInspector.svelte'
import ControlRoomGatedPreview from '../../src/lib/components/modules/control-room/ControlRoomGatedPreview.svelte'
import ControlRoomMetricsStack from '../../src/lib/components/modules/control-room/ControlRoomMetricsStack.svelte'
import ControlRoomNodeSelectorZone from '../../src/lib/components/modules/control-room/ControlRoomNodeSelectorZone.svelte'
import ControlRoomSystemStatusZone from '../../src/lib/components/modules/control-room/ControlRoomSystemStatusZone.svelte'
import type { OverviewData } from '../../src/lib/types.ts'
import { createOverviewFixture } from './_specs/fixtures'

/**
 * 控制室 zone 子组件的直接测试。
 *
 * 每个 zone 都以显式 props 独立渲染，不经过父组件、不依赖 appState，
 * 以此证明新的组件缝（seam）自身契约成立：props 进、渲染出，
 * 并且不隐式订阅任何全局状态。
 */
describe('ControlRoomSystemStatusZone', () => {
  const baseProps = {
    coreMode: 'normal' as OverviewData['core']['mode'],
    coreVersion: '0.1.0',
    eventBusMetrics: createOverviewFixture().eventBusMetrics,
    reachableNodeCount: 1,
    totalNodeCount: 2,
    selectedNodeName: 'Leaf 1',
    policySummary: null,
    auditAccessible: true,
    forcedRelaySummary: 'forced-tcp-relay · 1 nodes',
    eventStreamLastEventAt: undefined
  }

  it('renders all six status cards from explicit props', () => {
    render(ControlRoomSystemStatusZone, { props: baseProps })

    expect(screen.getByRole('heading', { name: '系统状态' })).toBeTruthy()
    for (const title of [
      'Core Health',
      'EventBus',
      'Leaf Nodes',
      'Policy Gate',
      'Audit Visibility',
      'Forced Relay'
    ]) {
      expect(screen.getByText(title)).toBeTruthy()
    }

    expect(screen.getByText('healthy')).toBeTruthy()
    expect(screen.getByText('1 / 2 reachable')).toBeTruthy()
    expect(screen.getByText('selected: Leaf 1')).toBeTruthy()
    expect(screen.getByText('granted')).toBeTruthy()
    expect(screen.getByText('forced-tcp-relay · 1 nodes')).toBeTruthy()
    expect(screen.getByText('stateSource: authoritative')).toBeTruthy()
    expect(screen.getByText('source: eventBusMetrics')).toBeTruthy()
    expect(screen.getByText('trace: cor_0.1.0')).toBeTruthy()
  })

  it('surfaces degraded core mode and denied audit visibility instead of healthy defaults', () => {
    render(ControlRoomSystemStatusZone, {
      props: { ...baseProps, coreMode: 'degraded', auditAccessible: false }
    })

    expect(screen.getByText('degraded')).toBeTruthy()
    expect(screen.getByText('denied')).toBeTruthy()
    expect(screen.queryByText('healthy')).toBeNull()
    expect(screen.queryByText('granted')).toBeNull()
  })

  it('falls back to placeholders when eventBus metrics are absent', () => {
    render(ControlRoomSystemStatusZone, { props: { ...baseProps, eventBusMetrics: null } })

    expect(screen.getByText('EventBus')).toBeTruthy()
    expect(screen.getByText('trace: —')).toBeTruthy()
  })
})

describe('ControlRoomNodeSelectorZone', () => {
  const nodes = createOverviewFixture().nodes

  it('renders one node chip per node and reports the inventory count', () => {
    render(ControlRoomNodeSelectorZone, {
      props: { nodes, selectedNodeId: 'leaf-1', onSelectNode: () => {} }
    })

    expect(screen.getByTestId('control-room-operations-panel')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '节点' })).toBeTruthy()
    expect(screen.getByText('Node inventory')).toBeTruthy()
    expect(screen.getByText('1')).toBeTruthy()

    const chip = screen.getByTestId('node-chip-Leaf 1')
    expect(chip).toBeTruthy()
    expect(within(chip).getByText('Leaf 1')).toBeTruthy()
    expect(within(chip).getByText('leaf')).toBeTruthy()
  })

  it('invokes onSelectNode with the clicked node id instead of touching the store', async () => {
    const onSelectNode = vi.fn()
    render(ControlRoomNodeSelectorZone, {
      props: { nodes, selectedNodeId: null, onSelectNode }
    })

    screen.getByTestId('node-chip-Leaf 1').click()

    expect(onSelectNode).toHaveBeenCalledTimes(1)
    expect(onSelectNode).toHaveBeenCalledWith('leaf-1')
  })

  it('renders the empty inventory copy when no nodes are supplied', () => {
    render(ControlRoomNodeSelectorZone, {
      props: { nodes: [], selectedNodeId: null, onSelectNode: () => {} }
    })

    expect(screen.getByText('暂无节点')).toBeTruthy()
    expect(screen.queryByTestId('node-chip-Leaf 1')).toBeNull()
  })
})

describe('ControlRoomMetricsStack', () => {
  const fixture = createOverviewFixture()

  it('merges timeline and audit rows into one ledger and renders the service map', () => {
    render(ControlRoomMetricsStack, {
      props: {
        timeline: fixture.timeline,
        auditEntries: fixture.audit,
        services: fixture.services
      }
    })

    const activityPanel = screen.getByTestId('control-room-recent-activity-panel')
    expect(within(activityPanel).getByText('leaf node joined test-network')).toBeTruthy()
    expect(within(activityPanel).getByText('Timeline')).toBeTruthy()
    expect(within(activityPanel).getByText('task.submit')).toBeTruthy()
    expect(within(activityPanel).getByText('Task')).toBeTruthy()
    expect(within(activityPanel).getByText('logged')).toBeTruthy()
    expect(within(activityPanel).getByText('allowed')).toBeTruthy()

    const metricsPanel = screen.getByTestId('control-room-metrics-panel')
    expect(within(metricsPanel).getByRole('heading', { name: '事件与审计账本' })).toBeTruthy()
    expect(within(metricsPanel).getByRole('heading', { name: '功能域服务状态' })).toBeTruthy()
    // endpoint 是展示层派生值，从 service domain 推导。
    expect(within(metricsPanel).getByText('mpolicy.internal:8082')).toBeTruthy()
    expect(within(metricsPanel).getByText('读模型')).toBeTruthy()
  })

  it('renders both empty states when no ledger rows and no services are supplied', () => {
    render(ControlRoomMetricsStack, {
      props: { timeline: [], auditEntries: null, services: [] }
    })

    expect(screen.getByText('暂无日志条目')).toBeTruthy()
    expect(screen.getByText('暂无功能域服务')).toBeTruthy()
  })
})

describe('ControlRoomContextInspector', () => {
  const node = createOverviewFixture().nodes[0]

  it('renders the four context sections for a selected node', () => {
    render(ControlRoomContextInspector, {
      props: {
        selectedNode: node,
        selectedNodeId: 'leaf-1',
        actor: 'operator',
        permissions: ['task:submit'],
        policySummary: null,
        taskCorrelationId: 'corr-1',
        taskId: 'task-1',
        taskStatus: 'accepted'
      }
    })

    const inspector = screen.getByLabelText('已选上下文')
    expect(within(inspector).getByRole('heading', { name: 'Leaf 1' })).toBeTruthy()
    expect(within(inspector).getByText('身份与权限')).toBeTruthy()
    expect(within(inspector).getByText('节点信息')).toBeTruthy()
    expect(within(inspector).getByText('策略上下文')).toBeTruthy()
    expect(within(inspector).getByText('跟踪上下文')).toBeTruthy()
    expect(within(inspector).getByText('task-1')).toBeTruthy()
    expect(within(inspector).getByText('accepted')).toBeTruthy()
    expect(within(inspector).getByText('corr-1')).toBeTruthy()
    expect(within(inspector).getByText('operator')).toBeTruthy()
    // task:submit 同时作为 permissions 与 node.capabilities 出现。
    expect(within(inspector).getAllByText('task:submit').length).toBe(2)
  })

  it('renders the empty context copy when no node is selected', () => {
    render(ControlRoomContextInspector, {
      props: {
        selectedNode: null,
        selectedNodeId: null,
        actor: null,
        permissions: [],
        policySummary: null,
        taskCorrelationId: undefined,
        taskId: '—',
        taskStatus: '—'
      }
    })

    const inspector = screen.getByLabelText('已选上下文')
    expect(within(inspector).getByRole('heading', { name: '未选择节点' })).toBeTruthy()
    expect(within(inspector).getByText('选择上方节点以查看上下文、策略与跟踪信息。')).toBeTruthy()
    expect(within(inspector).queryByText('身份与权限')).toBeNull()
  })
})

describe('ControlRoomGatedPreview', () => {
  it('renders the gated workbench skeleton with disabled command cards and no data props', () => {
    render(ControlRoomGatedPreview)

    const preview = screen.getByLabelText('未授权控制室预览')
    expect(within(preview).getByRole('heading', { name: '控制室总览' })).toBeTruthy()
    expect(within(preview).getByText('actor: 未授权')).toBeTruthy()
    expect(within(preview).getByText('core: gated')).toBeTruthy()
    expect(within(preview).getByText('执行上下文: gated')).toBeTruthy()

    expect(within(preview).getAllByText('待加载').length).toBe(5)
    expect(within(preview).getAllByText('stateSource: gated').length).toBe(5)
    expect(within(preview).getAllByText('状态: 未授权').length).toBe(4)
    expect(within(preview).getAllByText('target: 需要令牌').length).toBe(4)

    // 未授权分支不得渲染任何可点击的命令控件。
    expect(within(preview).queryAllByRole('button')).toEqual([])

    const previewInspector = screen.getByLabelText('未授权上下文')
    expect(within(previewInspector).getByText('请输入操作者令牌以加载控制室概览。')).toBeTruthy()
    expect(within(previewInspector).getByText('Bearer JWT')).toBeTruthy()
  })
})
