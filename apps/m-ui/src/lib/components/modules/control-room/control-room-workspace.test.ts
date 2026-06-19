import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import ControlRoomWorkspace from './ControlRoomWorkspace.svelte'
import { appState } from '$lib/stores.svelte.ts'
import { installAppStateReset } from '../../../../../tests/runtime/_specs/app-state'
import {
  createControlRoomCommandState,
  createOverviewFixture
} from '../../../../../tests/runtime/_specs/fixtures'

installAppStateReset()

describe('ControlRoomWorkspace seam', () => {
  it('renders primary landmarks correctly', () => {
    appState.overview = createOverviewFixture()
    appState.selectedNodeId = 'leaf-1'
    appState.commandState = createControlRoomCommandState()

    render(ControlRoomWorkspace)

    expect(document.title).toContain('控制室概览 | Meristem')
    expect(screen.getByRole('heading', { name: '控制室概览' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '节点' })).toBeTruthy()
    expect(screen.getByText('运行 noop 任务')).toBeTruthy()
  })
})
