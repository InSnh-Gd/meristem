import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$app/state', () => ({
  page: {
    params: { id: 'approval-1' }
  }
}))

import { appState } from '$lib/stores.svelte.ts'
import { installAppStateReset } from '../../../../../tests/runtime/_specs/app-state'
import { createApprovalDetailFixture } from '../../../../../tests/runtime/_specs/fixtures'
import ApprovalDetailWorkspace from './ApprovalDetailWorkspace.svelte'

installAppStateReset()

describe('ApprovalDetailWorkspace seam', () => {
  it('renders preview and command surfaces correctly', () => {
    appState.selectedApproval = createApprovalDetailFixture()

    render(ApprovalDetailWorkspace)

    expect(document.title).toContain('审批详情 | Meristem')
    expect(screen.getByLabelText('审批详情面板')).toBeTruthy()
    expect(screen.getByText('approval-1')).toBeTruthy()
    expect(screen.getByRole('button', { name: '批准审批请求' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '拒绝审批请求' })).toBeTruthy()
  })
})
