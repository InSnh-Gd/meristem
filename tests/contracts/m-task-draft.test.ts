import { describe, expect, it } from 'bun:test'

describe('M-Task draft alignment', () => {
  it('keeps Phase 11 as a draft without changing MVP noop compatibility', async () => {
    const phase11 = await Bun.file('docs/roadmap/PHASE-11.md').text()
    const taskRoute = await Bun.file('apps/core/src/routes/tasks.ts').text()

    expect(phase11).toContain('Status: Draft')
    expect(phase11).toContain('M-Task')
    expect(phase11).toContain('does not change the MVP `noop` contract')
    expect(phase11).toContain('The existing `task:assign` permission remains the MVP permission')
    expect(phase11).toContain('Keep current MVP `noop` task behavior stable')

    expect(taskRoute).toContain("action: 'task:assign'")
    expect(taskRoute).toContain("type: t.Literal('noop')")
    expect(taskRoute).not.toContain('m-task')
    expect(taskRoute).not.toContain('task:submit')
  })
})

