import { describe, expect, it } from 'bun:test'

describe('M-Task service alignment', () => {
  it('records the accepted M-Task cutover and implementation baseline', async () => {
    const mTaskDraftDoc = await Bun.file('docs/roadmap/PHASE-11.md').text()
    const adr25 = await Bun.file(
      'docs/adr/ADR-025-promote-m-task-to-canonical-task-service.md'
    ).text()
    const coreApp = await Bun.file('apps/core/src/app.ts').text()
    const taskApp = await Bun.file('services/m-task/src/app.ts').text()

    expect(mTaskDraftDoc).toContain('Status: Draft')
    expect(mTaskDraftDoc).toContain('Phase 11.1 - M-Task Service Cutover')
    expect(mTaskDraftDoc).toContain('Phase 11.2 - M-Policy Risk Foundation')
    expect(mTaskDraftDoc).toContain('Phase 11.3 - End-to-End MVP Closure')
    expect(mTaskDraftDoc).toContain('M-Task becomes a first-class REST / OpenAPI service')
    expect(mTaskDraftDoc).toContain('M-Task exposes /api/v0/tasks')
    expect(mTaskDraftDoc).toContain(
      '`meristem task assign` is not retained as a compatibility command'
    )
    expect(mTaskDraftDoc).toContain(
      'The existing `task:assign` permission is replaced by M-Task permissions'
    )

    expect(adr25).toContain('## Status\n\nAccepted')
    expect(adr25).toContain('M-Task becomes the canonical external REST / OpenAPI task API')
    expect(adr25).toContain('no Core task compatibility window is preserved')

    expect(coreApp).not.toContain('tasksRoutes')
    expect(taskApp).toMatch(/\.post\(\s*'\/api\/v0\/tasks',/)
    expect(taskApp).toContain("action: 'task:submit'")
    expect(taskApp).toContain("action: 'task:retry'")
  })
})
