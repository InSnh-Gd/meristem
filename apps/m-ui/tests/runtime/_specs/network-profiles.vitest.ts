import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import NetworkProfilesPage from '../../../src/routes/network/profiles/+page.svelte'
import { appState } from '../../../src/lib/stores.svelte.ts'
import { installAppStateReset } from './app-state'
import { createNetworkProfilesFixture } from './fixtures'

installAppStateReset()

describe('network profiles runtime behavior', () => {
  it('renders network profile list and control-plane warning without crashing', () => {
    appState.networkProfiles = createNetworkProfilesFixture()

    render(NetworkProfilesPage)

    expect(screen.getByRole('heading', { name: '网络 Profile' })).toBeTruthy()
    expect(screen.getByText('当前列表仅展示控制面 Profile。启用或停用动作保留为详情页中的禁用展示态。')).toBeTruthy()
    expect(screen.getByText('Global profile')).toBeTruthy()
    expect(screen.getByText('profile-v1')).toBeTruthy()
  })
})
