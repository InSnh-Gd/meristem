import { describe, expect, it } from 'bun:test'

describe('M-Task service alignment', () => {
  it('records the accepted M-Task cutover and implementation baseline', async () => {
    const roadmapDoc = await Bun.file('MERISTEM-ROADMAP.md').text()
    const adrT01 = await Bun.file('docs/adr/ADR-T01-m-task-canonical-service.md').text()
    const coreApp = await Bun.file('apps/core/src/app.ts').text()
    const taskApp = await Bun.file('services/m-task/src/app.ts').text()

    expect(roadmapDoc).toContain('M-Task | Task submission and lifecycle state are owned by M-Task')
    expect(roadmapDoc).toContain('Service lifecycle and M-Task')
    expect(roadmapDoc).toContain('v0.1 completion claim')

    expect(adrT01).toContain('## Status\n\nAccepted')
    expect(adrT01).toContain('M-Task becomes the canonical external REST / OpenAPI task API')
    expect(adrT01).toContain('no Core task compatibility window is preserved')

    expect(coreApp).not.toContain('tasksRoutes')
    expect(taskApp).toMatch(/\.post\(\s*'\/api\/v0\/tasks',/)
    expect(taskApp).toContain("action: 'task:submit'")
    expect(taskApp).toContain("action: 'task:retry'")
  })
})
