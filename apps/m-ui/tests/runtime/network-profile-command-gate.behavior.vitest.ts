import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

// 路由参数固定为 CN profile 版本，与现有 workspace seam 测试保持一致。
vi.mock('$app/state', () => ({
  page: {
    params: { profileVersion: 'm-net-cn@0.3.0' }
  }
}))

// executeCommand spy 需经 vi.hoisted 提升，避免 mock 工厂 hoist 后访问不到顶层变量。
const { executeCommandMock } = vi.hoisted(() => ({
  executeCommandMock: vi.fn(async () => ({
    status: 'pending_approval' as const,
    correlationId: 'corr-profile-gate-1',
    operationId: 'op-profile-gate-1',
    approvalId: 'approval-profile-gate-1',
    profileVersion: 'm-net-cn@0.3.0'
  }))
}))

// 只 mock 测试链路真正触达的 BFF 出口；store 其余导入在 token 门禁下不会被调用。
vi.mock('$lib/bff.ts', () => ({
  bffFetch: vi.fn(async () => ({
    networks: [
      {
        id: 'net-cn-001',
        name: 'CN 网络',
        profileVersion: 'm-net-cn@0.3.0',
        status: 'active',
        createdAt: '2026-08-01T00:00:00Z',
        memberCount: 3
      }
    ]
  })),
  executeCommand: executeCommandMock,
  formatBffError: vi.fn((error: unknown, fallback: string) => {
    return `${fallback}: ${error instanceof Error ? error.message : 'Unknown error'}`
  }),
  fetchGlobalDefaults: vi.fn(async () => {
    throw new Error('not exercised')
  }),
  fetchMigrationStatus: vi.fn(async () => {
    throw new Error('not exercised')
  }),
  isDevelopmentBearerMode: vi.fn(() => false)
}))

import { appState } from '../../src/lib/stores.svelte.ts'
import NetworkProfileWorkspace from '../../src/lib/components/modules/network/NetworkProfileWorkspace.svelte'
import { installAppStateReset } from './_specs/app-state'
import { createNetworkProfileDetailFixture } from './_specs/fixtures'

installAppStateReset()

// happy-dom 未实现 option 的 :checked 伪类匹配，而 Svelte 5 的 select bind:value
// 在 change 时通过 select.querySelector(':checked') 读取选中项。这里在本测试
// 文件环境内为 HTMLSelectElement 补齐这一最小语义（仅处理 Svelte 运行时实际
// 发出的裸 ':checked' 查询，其余选择器原样透传）；vitest 为每个测试文件创建
// 独立 happy-dom 环境，补丁不会泄漏到其他文件。
const originalSelectQuerySelector = HTMLSelectElement.prototype.querySelector
HTMLSelectElement.prototype.querySelector = function (
  this: HTMLSelectElement,
  selector: string
): Element | null {
  if (selector === ':checked') {
    return Array.from(this.options).find(option => option.selected) ?? null
  }
  return originalSelectQuerySelector.call(this, selector)
}

/**
 * Profile CommandWell 确认门禁的宿主级刻画测试。
 *
 * 拆分前后都必须成立的不变量：
 * - 未选择目标网络时命令卡片只展示禁用原因，不暴露任何执行入口。
 * - 首次点击「执行」只进入待确认态，不触发 executeCommand。
 * - 「确认执行」才向 BFF CommandWell 执行端点派发对应命令；
 *   enable 固定目标 m-net-cn@0.3.0，disable 固定目标 m-net@0.3.0。
 * - 「取消」清除待确认态且不派发任何命令。
 */
async function renderLoadedWorkspace() {
  appState.token = 'fixture-token'
  appState.selectedProfile = createNetworkProfileDetailFixture()
  // 阻止 onMount 的真实详情拉取清空已注入的 fixture。
  vi.spyOn(appState, 'fetchNetworkProfileDetail').mockResolvedValue(undefined)

  render(NetworkProfileWorkspace)

  // 等待组件本地网络列表经 mock bffFetch 就绪。
  const select = await screen.findByLabelText('目标网络')
  await waitFor(() => {
    expect((select as HTMLSelectElement).disabled).toBe(false)
  })
  return { select: select as HTMLSelectElement }
}

async function selectTargetNetwork(select: HTMLSelectElement) {
  // happy-dom 下直接给 select.value 赋值不会让 option 命中 :checked，
  // 而 Svelte 5 的 bind:value 在 change 时读取 querySelector(':checked')，
  // 因此先显式选中目标 option 再派发 change。
  const option = select.querySelector('option[value="net-cn-001"]') as HTMLOptionElement | null
  if (!option) throw new Error('option net-cn-001 missing from profile select')
  option.selected = true
  await fireEvent.change(select)
}

function commandWellZone() {
  return within(screen.getByLabelText('Profile CommandWell'))
}

describe('network profile workspace CommandWell confirmation gates', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    executeCommandMock.mockClear()
  })

  it('blocks both command entries behind the missing-network reason until a target is selected', async () => {
    await renderLoadedWorkspace()

    const zone = commandWellZone()
    expect(zone.getByTestId('profile-command-disabled-reason').textContent).toContain(
      '请先选择目标网络'
    )
    // 未选网络时不存在任何「执行」入口，两个卡片都只展示禁用状态。
    expect(zone.queryByRole('button', { name: '执行' })).toBeNull()
    expect(zone.getAllByText('请先选择目标网络').length).toBeGreaterThan(0)
  })

  it('routes the first enable click to confirmation instead of executing', async () => {
    const { select } = await renderLoadedWorkspace()
    await selectTargetNetwork(select)

    const zone = commandWellZone()
    const executeButtons = zone.getAllByRole('button', { name: '执行' })
    await fireEvent.click(executeButtons[0])

    // 第一次点击只请求确认：出现确认/取消动作，且不派发命令。
    expect(await zone.findByText('状态: 需要确认')).toBeTruthy()
    expect(zone.getByRole('button', { name: '确认执行' })).toBeTruthy()
    expect(zone.getByRole('button', { name: '取消' })).toBeTruthy()
    expect(executeCommandMock).not.toHaveBeenCalled()
  })

  it('dispatches network.profile.enable.execute only after explicit confirmation', async () => {
    const { select } = await renderLoadedWorkspace()
    await selectTargetNetwork(select)

    const zone = commandWellZone()
    await fireEvent.click(zone.getAllByRole('button', { name: '执行' })[0])
    await fireEvent.click(await zone.findByRole('button', { name: '确认执行' }))

    await waitFor(() => {
      expect(executeCommandMock).toHaveBeenCalledTimes(1)
    })
    expect(executeCommandMock).toHaveBeenCalledWith(
      'fixture-token',
      'network.profile.enable.execute',
      { networkId: 'net-cn-001', profileVersion: 'm-net-cn@0.3.0' }
    )
    // 确认派发后待确认态清除，结果面板展示 BFF 返回的相关性证据。
    expect(await zone.findByText('corr-profile-gate-1')).toBeTruthy()
  })

  it('clears the pending enable confirmation on cancel without dispatching', async () => {
    const { select } = await renderLoadedWorkspace()
    await selectTargetNetwork(select)

    const zone = commandWellZone()
    await fireEvent.click(zone.getAllByRole('button', { name: '执行' })[0])
    await fireEvent.click(await zone.findByRole('button', { name: '取消' }))

    expect(zone.queryByText('状态: 需要确认')).toBeNull()
    expect(executeCommandMock).not.toHaveBeenCalled()
    // 取消后执行入口恢复可用。
    expect(zone.getAllByRole('button', { name: '执行' }).length).toBe(2)
  })

  it('dispatches network.profile.disable.execute with the m-net restore target after confirmation', async () => {
    const { select } = await renderLoadedWorkspace()
    await selectTargetNetwork(select)

    const zone = commandWellZone()
    const executeButtons = zone.getAllByRole('button', { name: '执行' })
    await fireEvent.click(executeButtons[1])
    await fireEvent.click(await zone.findByRole('button', { name: '确认执行' }))

    await waitFor(() => {
      expect(executeCommandMock).toHaveBeenCalledTimes(1)
    })
    expect(executeCommandMock).toHaveBeenCalledWith(
      'fixture-token',
      'network.profile.disable.execute',
      { networkId: 'net-cn-001', profileVersion: 'm-net@0.3.0' }
    )
  })
})
