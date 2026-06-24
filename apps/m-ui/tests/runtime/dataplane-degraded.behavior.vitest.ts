import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/bff.ts', () => ({
  fetchDataplaneStatus: vi.fn(async () => {
    throw new Error('dataplane offline')
  }),
  fetchNetworkMapSummary: vi.fn(async () => {
    throw new Error('map offline')
  }),
  formatBffError: vi.fn((error: unknown, fallback: string) => {
    return `${fallback}: ${error instanceof Error ? error.message : 'Unknown error'}`
  })
}))

import { appState } from '../../src/lib/stores.svelte.ts'
import DataplaneStatusPage from '../../src/routes/mnet/dataplane-status/+page.svelte'
import { installAppStateReset } from './_specs/app-state'

installAppStateReset()

describe('dataplane degraded behavior', () => {
  it('shows InlineOperationalAlert when dataplane status loading fails', async () => {
    appState.token = 'fixture-token'

    const { getByPlaceholderText, getByRole } = render(DataplaneStatusPage)

    // Set networkId
    const input = getByPlaceholderText('输入网络 ID')
    await fireEvent.input(input, { target: { value: 'net-123' } })

    // Click submit
    const button = getByRole('button', { name: '查询' })
    await fireEvent.click(button)

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('dataplane offline')
    })
  })
})
