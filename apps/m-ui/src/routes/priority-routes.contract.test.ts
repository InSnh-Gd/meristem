import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const readRoute = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8')

describe('priority M-UI route source contracts', () => {
  it('keeps control-room delegation to ControlRoomWorkspace', () => {
    const source = readRoute('./control-room/+page.svelte')

    // Thin route glue: delegates all workbench logic to ControlRoomWorkspace
    expect(source).toContain('ControlRoomWorkspace')
    expect(source).toContain("from '$lib/components/modules/control-room/ControlRoomWorkspace.svelte'")
  })

  it('keeps approvals route wired to approval queue loading and preview surfaces', () => {
    const source = readRoute('./policy/approvals/+page.svelte')

    expect(source).toContain('void muiStores.fetchApprovalQueue()')
    expect(source).toContain('ApprovalQueuePanel')
    expect(source).toContain('DecisionQueueSummary')
    expect(source).toContain('OperationalCommandPreview')
  })

  it('keeps network profiles route wired to BFF-backed profile list and degraded-state messaging', () => {
    const source = readRoute('./network/profiles/+page.svelte')

    expect(source).toContain('void muiStores.fetchNetworkProfiles()')
    expect(source).toContain('NetworkProfileListPanel')
    expect(source).toContain('InlineOperationalAlert')
  })

  it('keeps break-glass delegation to BreakGlassWorkspace', () => {
    const source = readRoute('./mnet/break-glass/+page.svelte')

    // Thin route glue: delegates all controlled-action and guardrail logic to BreakGlassWorkspace
    expect(source).toContain('BreakGlassWorkspace')
    expect(source).toContain("from '$lib/components/modules/network/BreakGlassWorkspace.svelte'")
  })
})
