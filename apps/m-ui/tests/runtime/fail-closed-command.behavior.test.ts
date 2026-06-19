import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/bff.ts', () => ({
  fetchCommandState: vi.fn(async () => {
    throw new Error('policy engine unreachable')
  }),
  formatBffError: vi.fn((error: unknown, fallback: string) => {
    return `${fallback}: ${error instanceof Error ? error.message : 'Unknown error'}`
  })
}))

import CommandWell from '../../src/lib/components/modules/command/CommandWell.svelte'
import { appState } from '../../src/lib/stores.svelte.ts'
import { installAppStateReset } from './_specs/app-state'

installAppStateReset()

describe('fail-closed command well behavior', () => {
  it('shows InlineOperationalAlert when command state loading fails', async () => {
    appState.token = 'fixture-token'

    await appState.selectNode('node-123')

    render(CommandWell, {
      props: {
        commandState: appState.commandState,
        commandStateError: appState.commandStateError,
        selectedNode: null,
        confirming: false,
        onRequestConfirm: () => {},
        onCancel: () => {},
        onConfirm: () => {}
      }
    })

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('操作状态加载失败: policy engine unreachable')
    })
  })
})
