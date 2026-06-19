import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/state', () => ({
  page: {
    params: { profileVersion: 'm-net-cn@0.1.0' }
  }
}))

import NetworkProfileWorkspace from './NetworkProfileWorkspace.svelte'
import { appState } from '$lib/stores.svelte.ts'
import { installAppStateReset } from '../../../../../tests/runtime/_specs/app-state'
import { createNetworkProfileDetailFixture } from '../../../../../tests/runtime/_specs/fixtures'

installAppStateReset()

describe('NetworkProfileWorkspace seam', () => {
  it('renders global controls and target selector correctly', () => {
    appState.selectedProfile = createNetworkProfileDetailFixture()

    render(NetworkProfileWorkspace)

    expect(document.title).toContain('Profile 详情 | Meristem')
    expect(screen.getByLabelText('网络 Profile 详情面板')).toBeTruthy()
    expect(screen.getByText('CN profile')).toBeTruthy()
    expect(screen.getByLabelText('目标网络')).toBeTruthy()
    expect(screen.getAllByText('配置变更仅影响控制平面，运行时数据面不受影响').length).toBeGreaterThan(0)
  })
})
