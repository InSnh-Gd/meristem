import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import ControlRoomPage from '../../../src/routes/control-room/+page.svelte'
import { appState } from '../../../src/lib/stores.svelte.ts'
import { installAppStateReset } from './app-state'
import { createControlRoomCommandState, createOverviewFixture } from './fixtures'

installAppStateReset()

describe('control-room runtime behavior', () => {
  it('renders overview panels and CommandWell without crashing', () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()

    render(ControlRoomPage)

    expect(screen.getByRole('heading', { name: '控制室概览' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '节点' })).toBeTruthy()
    expect(screen.getByTestId('node-chip-Leaf 1')).toBeTruthy()
    expect(screen.getByText('leaf node joined test-network')).toBeTruthy()
    expect(screen.getByText('运行 noop 任务')).toBeTruthy()
  })
})
