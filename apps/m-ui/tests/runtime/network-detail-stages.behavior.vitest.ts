import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

// 路由依赖 $app/state 解析 [id] 参数；固定为 fixture 网络 id 以获得确定性渲染。
vi.mock('$app/state', () => ({
  page: {
    params: {
      id: 'net-loop-001'
    }
  }
}))

import { appState } from '../../src/lib/stores.svelte.ts'
import type { NetworkRuntimeTruth } from '../../src/lib/types.ts'
import NetworkDetailPage from '../../src/routes/networks/[id]/+page.svelte'
import { installAppStateReset } from './_specs/app-state'
import {
  createJoinTicketsFixture,
  createNetworkDetailFixture,
  createOperationalStateFixture,
  createProofPathFixture
} from './_specs/network-loop-fixtures'

/** 契约允许的禁用原因码集合，从 runtimeTruth 修复动作类型派生，避免手写字面量漂移。 */
type RepairDisabledReasonCode = NonNullable<
  NetworkRuntimeTruth['repairActions'][number]['disabledReason']
>['code']

installAppStateReset()

/**
 * 播种五阶段渲染所需的全部 store 字段，等价于路由在真实加载完成后的稳定态。
 * 刻意不设置 token：store 的所有拉取入口都以 token 为前置守卫，
 * 因此 onMount 不会覆写这里播种的快照，渲染输出保持确定性。
 */
function seedAppState(runtimeState = createProofPathFixture()) {
  appState.selectedNetwork = createNetworkDetailFixture()
  appState.selectedNetworkLoading = false
  appState.selectedNetworkError = null
  appState.operationalState = createOperationalStateFixture()
  appState.operationalStateLoading = false
  appState.operationalStateError = null
  appState.networkRuntimeState = runtimeState
  appState.networkRuntimeStateLoading = false
  appState.networkRuntimeStateError = null
  appState.joinTickets = createJoinTicketsFixture()
}

describe('network detail route stage characterization', () => {
  it('renders the five canonical stage sections with markers, titles and hints', () => {
    seedAppState()

    render(NetworkDetailPage)

    const createSelect = screen.getByTestId('stage-create-select')
    expect(createSelect.id).toBe('stage-create-select')
    expect(createSelect.textContent).toContain('1')
    expect(createSelect.textContent).toContain('创建 / 选择网络')
    expect(createSelect.textContent).toContain('选择或创建目标网络，作为管理循环的起点。')

    const configure = screen.getByTestId('stage-configure')
    expect(configure.id).toBe('stage-configure')
    expect(configure.textContent).toContain('2')
    expect(configure.textContent).toContain('配置网络')
    expect(configure.textContent).toContain('查看数据面配置、网络地图与成员拓扑。')

    const enable = screen.getByTestId('stage-enable')
    expect(enable.id).toBe('stage-enable')
    expect(enable.textContent).toContain('3')
    expect(enable.textContent).toContain('启用 Profile')
    expect(enable.textContent).toContain(
      '通过 CommandWell 启用 v0.3 Profile；BFF 仅展示策略资格，最终授权由 M-Policy 决定。'
    )

    const observe = screen.getByTestId('stage-observe')
    expect(observe.id).toBe('stage-observe')
    expect(observe.textContent).toContain('4')
    expect(observe.textContent).toContain('观察运行态')
    expect(observe.textContent).toContain(
      '对照 desired / observed NetBird 状态、凭证生命周期与部署进度。'
    )

    const repair = screen.getByTestId('stage-repair')
    expect(repair.id).toBe('stage-repair')
    expect(repair.textContent).toContain('5')
    expect(repair.textContent).toContain('修复')
    expect(repair.textContent).toContain(
      '通过 CommandWell 触发受支持的修复命令；禁用态会展示具体修复指导。'
    )
  })

  it('keeps stage sections in canonical document order', () => {
    seedAppState()

    render(NetworkDetailPage)

    const ordered = Array.from(
      document.querySelectorAll<HTMLElement>('section[data-testid^="stage-"]')
    ).map(el => el.dataset.testid)

    expect(ordered).toEqual([
      'stage-create-select',
      'stage-configure',
      'stage-enable',
      'stage-observe',
      'stage-repair'
    ])
  })

  it('renders the enable stage profile state, reason and command eligibility rows', () => {
    seedAppState()

    render(NetworkDetailPage)

    expect(screen.getByTestId('enable-grid')).toBeTruthy()
    expect(screen.getByTestId('profile-enable-state').textContent).toContain('已启用')
    expect(screen.getByTestId('profile-enable-reason').textContent).toContain('Profile 已成功启用')

    const eligibility = screen.getByTestId('profile-enable-eligibility')
    expect(eligibility.textContent).toContain('启用命令资格')
    expect(eligibility.textContent).toContain('可执行')
    expect(screen.getByText('Profile 启用状态')).toBeTruthy()
  })

  it('renders the enable stage degraded profile state and disabled eligibility reason', () => {
    const runtimeState = createProofPathFixture()
    runtimeState.runtimeTruth.profile = {
      state: 'degraded',
      reason: '配置文件存在不兼容变更',
      stateSource: { sourceType: 'read-model', sourceId: 'mnet:degraded' }
    }
    runtimeState.policyEligibility.commands = [
      {
        commandId: 'network.profile.enable.execute',
        label: '启用 Profile',
        action: 'network:profile-enable',
        resource: 'network:net-loop-001',
        requiredPermissions: ['network:profile-enable'],
        requiresPolicy: true,
        requiresAudit: true,
        state: 'disabled',
        disabledReason: {
          code: 'missing_permission',
          message: '缺少权限：network:profile-enable',
          missingPermission: 'network:profile-enable'
        },
        summary: 'profile enable is not eligible'
      }
    ]
    seedAppState(runtimeState)

    render(NetworkDetailPage)

    expect(screen.getByTestId('profile-enable-state').textContent).toContain('已降级')
    expect(screen.getByTestId('profile-enable-reason').textContent).toContain(
      '配置文件存在不兼容变更'
    )
    expect(screen.getByTestId('profile-enable-eligibility').textContent).toContain('已禁用')
    expect(screen.getByTestId('profile-enable-disabled-reason').textContent).toContain(
      '缺少权限：network:profile-enable'
    )
  })

  it('renders the observe stage runtime cards with desired/observed NetBird truth', () => {
    seedAppState()

    render(NetworkDetailPage)

    expect(screen.getByTestId('observe-grid')).toBeTruthy()

    const netbird = screen.getByTestId('observe-netbird-process')
    expect(netbird.textContent).toContain('NetBird 进程状态')
    expect(netbird.textContent).toContain('期望态 (desired)')
    expect(netbird.textContent).toContain('观测态 (observed)')
    expect(netbird.textContent).toContain('健康度')
    expect(netbird.textContent).toContain('运行')
    expect(netbird.textContent).toContain('运行中')
    expect(netbird.textContent).toContain('健康')
    expect(netbird.textContent).toContain('NetBird process is running and healthy')

    // 节点级 desired/observed 对照表按 nodeId 生成稳定 testid。
    const stemRow = screen.getByTestId('netbird-process-node-stem-loop-001')
    expect(stemRow.textContent).toContain('stem-loop-001')
    expect(stemRow.textContent).toContain('NetBird is running on stem')
    expect(screen.getByTestId('netbird-process-node-leaf-loop-001').textContent).toContain(
      'NetBird is running on leaf'
    )
    expect(screen.getByText('节点')).toBeTruthy()
    expect(screen.getByText('详情')).toBeTruthy()

    const packetProof = screen.getByTestId('observe-packet-proof')
    expect(packetProof.textContent).toContain('数据包可达性证明')
    expect(packetProof.textContent).toContain('证明结果')
    expect(packetProof.textContent).toContain('可达')
    expect(packetProof.textContent).toContain('目标 Overlay IP')
    expect(packetProof.textContent).toContain('100.64.0.2')
    expect(packetProof.textContent).toContain('探测类型')
    expect(packetProof.textContent).toContain('tcp')

    const secretProvider = screen.getByTestId('observe-secret-provider')
    expect(secretProvider.textContent).toContain('SecretProvider 状态')
    expect(secretProvider.textContent).toContain('已就绪')
    expect(secretProvider.textContent).toContain('secret provider resolved')
  })

  it('renders the observe stage credential and progress subsections', () => {
    seedAppState()

    render(NetworkDetailPage)

    expect(screen.getByText('凭证生命周期')).toBeTruthy()
    expect(screen.getByText('运营与部署进度')).toBeTruthy()
    expect(document.querySelector('#network-credential-lifecycle')).toBeTruthy()
    expect(document.querySelector('#network-operational-progress')).toBeTruthy()
  })

  it('renders the repair stage enabled action rows', () => {
    seedAppState()

    render(NetworkDetailPage)

    expect(screen.getByTestId('repair-list')).toBeTruthy()
    const row = screen.getByTestId('repair-action-network.forced-relay.change.execute')
    expect(row.textContent).toContain('network.forced-relay.change.execute')
    expect(row.textContent).toContain('可执行')
    expect(screen.getByText('Join Tickets')).toBeTruthy()
  })

  it('renders repair guidance text for each documented disabled reason code', () => {
    const expectations: ReadonlyArray<readonly [RepairDisabledReasonCode, string]> = [
      ['missing_permission', '缺少权限，无法发起修复命令'],
      ['migration_required', '需先完成 Profile 迁移后再执行修复'],
      ['missing_secret_provider', 'SecretProvider 不可用，凭证材料无法注入'],
      ['stale_jwks', 'JWKS 缓存已过期'],
      ['missing_signal_relay', 'Signal/Relay 端点不可达']
    ]

    for (const [code, expectedText] of expectations) {
      const runtimeState = createProofPathFixture()
      runtimeState.runtimeTruth.repairActions = [
        {
          commandId: 'network.forced-relay.change.execute',
          state: 'disabled',
          disabledReason: {
            code,
            message: 'fixture disabled message'
          },
          stateSource: { sourceType: 'policy', sourceId: 'm-policy:fixture' }
        }
      ]
      seedAppState(runtimeState)

      const view = render(NetworkDetailPage)
      const guidance = screen.getByTestId('repair-guidance-network.forced-relay.change.execute')
      expect(guidance.textContent).toContain(expectedText)
      view.unmount()
    }
  })

  it('falls back to the disabled message for reason codes without dedicated guidance', () => {
    const runtimeState = createProofPathFixture()
    runtimeState.runtimeTruth.repairActions = [
      {
        commandId: 'network.forced-relay.change.execute',
        state: 'disabled',
        disabledReason: {
          code: 'target_missing',
          message: '自定义禁用说明'
        },
        stateSource: { sourceType: 'policy', sourceId: 'm-policy:fixture' }
      }
    ]
    seedAppState(runtimeState)

    render(NetworkDetailPage)

    expect(
      screen.getByTestId('repair-guidance-network.forced-relay.change.execute').textContent
    ).toContain('自定义禁用说明')
  })

  it('renders an empty repair placeholder when no repair actions are available', () => {
    const runtimeState = createProofPathFixture()
    runtimeState.runtimeTruth.repairActions = []
    seedAppState(runtimeState)

    render(NetworkDetailPage)

    expect(screen.queryByTestId('repair-list')).toBeNull()
    expect(screen.getByText('暂无可用修复命令。')).toBeTruthy()
  })

  it('renders the runtime error alert with a retry control instead of the enable grid', () => {
    seedAppState()
    appState.networkRuntimeState = null
    appState.networkRuntimeStateError = '运行态聚合不可用'

    render(NetworkDetailPage)

    expect(screen.queryByTestId('enable-grid')).toBeNull()
    expect(screen.queryByTestId('observe-grid')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain('运行态聚合不可用')
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
  })

  it('renders the runtime loading line while the aggregate is still in flight', () => {
    seedAppState()
    appState.networkRuntimeState = null
    appState.networkRuntimeStateLoading = true

    render(NetworkDetailPage)

    expect(screen.getAllByText('正在加载运行态...').length).toBeGreaterThan(0)
  })

  it('hosts the CommandWell region and the route header outside the stage sections', () => {
    seedAppState()

    render(NetworkDetailPage)

    expect(screen.getByRole('heading', { name: '网络详情' })).toBeTruthy()
    // CommandWell 由路由承载而非被阶段子视图吸收；空态文案是其宿主边界证据。
    expect(screen.getByText('请在面板中验证操作资格')).toBeTruthy()
  })

  it('renders loading, error and not-found route states without stage sections', () => {
    appState.selectedNetworkLoading = true
    const loadingView = render(NetworkDetailPage)
    expect(screen.getByText('正在加载网络详情...')).toBeTruthy()
    expect(screen.queryByTestId('stage-create-select')).toBeNull()
    loadingView.unmount()

    appState.selectedNetworkLoading = false
    appState.selectedNetworkError = '网络详情加载失败'
    const errorView = render(NetworkDetailPage)
    expect(screen.getByText('网络详情加载失败')).toBeTruthy()
    expect(screen.queryByTestId('stage-configure')).toBeNull()
    errorView.unmount()

    appState.selectedNetworkError = null
    appState.selectedNetwork = null
    render(NetworkDetailPage)
    expect(screen.getByText('net-loop-001')).toBeTruthy()
    expect(screen.queryByTestId('stage-repair')).toBeNull()
  })
})
