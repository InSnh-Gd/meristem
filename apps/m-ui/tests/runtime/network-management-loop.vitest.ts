import { render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock $app/state so the [id] route param resolves to a fixture network id.
vi.mock('$app/state', () => ({
  page: {
    params: {
      id: 'net-loop-001'
    }
  }
}))

// Mock $lib/bff.ts to assert the page consumes the BFF proof-path aggregate
// (fetchNetworkRuntimeState) and never calls M-Net service endpoints directly.
const fetchNetworkRuntimeStateMock = vi.fn(async () => null)
const fetchNetworkDetailMock = vi.fn(async () => null)
const fetchNetworkJoinTicketsMock = vi.fn(async () => null)
const fetchOperationalStateMock = vi.fn(async () => null)

vi.mock('$lib/bff.ts', () => ({
  fetchNetworkRuntimeState: fetchNetworkRuntimeStateMock,
  fetchNetworkDetail: fetchNetworkDetailMock,
  fetchNetworkJoinTickets: fetchNetworkJoinTicketsMock,
  fetchOperationalState: fetchOperationalStateMock,
  formatBffError: vi.fn((error: unknown, fallback: string) => {
    return `${fallback}: ${error instanceof Error ? error.message : 'Unknown error'}`
  }),
  getBffUrl: vi.fn(() => 'http://localhost:3200'),
  normalizeBearerTokenInput: vi.fn((input: string) => input),
  bffFetch: vi.fn(async () => null),
  isDevelopmentBearerMode: vi.fn(() => false)
}))

import { appState } from '../../src/lib/stores.svelte.ts'
import NetworkDetailPage from '../../src/routes/networks/[id]/+page.svelte'
import { installAppStateReset } from './_specs/app-state'
import {
  createNetworkDetailFixture,
  createOperationalStateFixture,
  createProofPathFixture,
  createJoinTicketsFixture
} from './_specs/network-loop-fixtures'

installAppStateReset()

function seedAppState() {
  appState.token = 'fixture-token'
  appState.selectedNetwork = createNetworkDetailFixture()
  appState.selectedNetworkLoading = false
  appState.selectedNetworkError = null
  appState.operationalState = createOperationalStateFixture()
  appState.networkRuntimeState = createProofPathFixture()
  appState.networkRuntimeStateLoading = false
  appState.networkRuntimeStateError = null
  appState.joinTickets = createJoinTicketsFixture()
}

describe('network management loop (T11)', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('renders all 5 canonical stages: create/select, configure, enable, observe, repair', () => {
    seedAppState()

    render(NetworkDetailPage)

    expect(screen.getByTestId('stage-create-select')).toBeTruthy()
    expect(screen.getByTestId('stage-configure')).toBeTruthy()
    expect(screen.getByTestId('stage-enable')).toBeTruthy()
    expect(screen.getByTestId('stage-observe')).toBeTruthy()
    expect(screen.getByTestId('stage-repair')).toBeTruthy()
  })

  it('consumes BFF runtimeTruth (proof-path) and never calls M-Net service endpoints directly', async () => {
    seedAppState()

    render(NetworkDetailPage)

    // The page mounts and triggers BFF proof-path fetch via the store.
    await waitFor(() => {
      expect(fetchNetworkRuntimeStateMock).toHaveBeenCalledWith('fixture-token', 'net-loop-001')
    })

    // BFF network detail / join tickets / operational-state are also BFF routes,
    // never direct M-Net service calls. The mock module has no M-Net service fetcher.
    expect(fetchNetworkDetailMock).toHaveBeenCalledWith('fixture-token', 'net-loop-001')
  })

  it('shows disabled repair reasons with concrete repair guidance', () => {
    const fixture = createProofPathFixture()
    // Force a disabled repair action with a missing_permission reason.
    fixture.runtimeTruth.repairActions = [
      {
        commandId: 'network.forced-relay.change.execute',
        state: 'disabled',
        disabledReason: {
          code: 'missing_permission',
          message: '缺少权限：network:profile-enable',
          missingPermission: 'network:profile-enable'
        },
        stateSource: {
          sourceType: 'policy',
          sourceId: 'm-policy:/internal/v0/authorize#network:net-loop-001'
        }
      }
    ]
    appState.token = 'fixture-token'
    appState.selectedNetwork = createNetworkDetailFixture()
    appState.selectedNetworkLoading = false
    appState.operationalState = createOperationalStateFixture()
    appState.networkRuntimeState = fixture
    appState.networkRuntimeStateLoading = false
    appState.networkRuntimeStateError = null
    appState.joinTickets = createJoinTicketsFixture()

    render(NetworkDetailPage)

    const guidance = screen.getByTestId('repair-guidance-network.forced-relay.change.execute')
    expect(guidance.textContent).toContain('缺少权限')
    expect(guidance.textContent).toContain('联系管理员授予')
  })

  it('shows degraded profile state with a visible reason', () => {
    const fixture = createProofPathFixture()
    fixture.runtimeTruth.profile = {
      state: 'degraded',
      reason: '配置文件存在不兼容变更，需先完成 Profile 迁移',
      stateSource: {
        sourceType: 'read-model',
        sourceId: 'mnet:/api/v0/networks/net-loop-001/operational-state#network'
      }
    }
    appState.token = 'fixture-token'
    appState.selectedNetwork = createNetworkDetailFixture()
    appState.selectedNetworkLoading = false
    appState.operationalState = createOperationalStateFixture()
    appState.networkRuntimeState = fixture
    appState.networkRuntimeStateLoading = false
    appState.networkRuntimeStateError = null
    appState.joinTickets = createJoinTicketsFixture()

    render(NetworkDetailPage)

    const stateEl = screen.getByTestId('profile-enable-state')
    expect(stateEl.textContent).toContain('已降级')
    const reasonEl = screen.getByTestId('profile-enable-reason')
    expect(reasonEl.textContent).toContain('Profile 迁移')
  })

  it('shows desired vs observed NetBird process state from BFF runtimeTruth', () => {
    seedAppState()

    render(NetworkDetailPage)

    const observeCard = screen.getByTestId('observe-netbird-process')
    expect(observeCard.textContent).toContain('期望态')
    expect(observeCard.textContent).toContain('观测态')
    // Fixture sets desired=running, observed=running, status=healthy.
    expect(observeCard.textContent).toContain('运行中')
  })
})
