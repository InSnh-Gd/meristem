import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import { appState } from '../../../src/lib/stores.svelte.ts'
import PolicyPendingPage from '../../../src/routes/policy/approvals/+page.svelte'
import { installAppStateReset } from './app-state'
import { createApprovalQueueFixture } from './fixtures'

installAppStateReset()

describe('policy pending runtime behavior', () => {
  it('renders pending approvals and preview surfaces without crashing', () => {
    appState.approvalQueue = createApprovalQueueFixture()

    render(PolicyPendingPage)

    expect(screen.getByRole('heading', { name: '审批队列' })).toBeTruthy()
    expect(screen.getByText('1 项待审')).toBeTruthy()
    expect(screen.getByText('approval-1')).toBeTruthy()
    expect(screen.getByText('批准审批请求')).toBeTruthy()
    expect(screen.getByText('拒绝审批请求')).toBeTruthy()
  })
})
