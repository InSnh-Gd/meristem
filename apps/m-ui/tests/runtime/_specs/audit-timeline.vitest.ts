import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import AuditPage from '../../../src/routes/audit/+page.svelte'
import { appState } from '../../../src/lib/stores.svelte.ts'
import { installAppStateReset } from './app-state'
import { createAuditFixture } from './fixtures'

installAppStateReset()

describe('audit timeline runtime behavior', () => {
  it('renders audit ledger rows without crashing', () => {
    appState.audit = createAuditFixture()

    render(AuditPage)

    expect(screen.getByRole('heading', { name: '审计' })).toBeTruthy()
    expect(screen.getByText('高可信审计账本')).toBeTruthy()
    expect(screen.getByText('task.submit')).toBeTruthy()
    expect(screen.getByText('node/leaf-1')).toBeTruthy()
    expect(screen.getByText('allowed')).toBeTruthy()
  })
})
