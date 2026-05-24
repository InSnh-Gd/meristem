import { describe, expect, it } from 'bun:test'
import * as schema from '../../packages/db/src/schema.ts'

describe('M-Task PostgreSQL schema contract', () => {
  it('defines Phase 11 M-Task-owned authoritative task tables', async () => {
    const migration = await Bun.file('packages/db/src/migrate.ts').text()
    const serviceEntry = await Bun.file('services/m-task/src/index.ts').text()
    const adapter = await Bun.file('services/m-task/src/storage-adapter.ts').text()
    const seed = await Bun.file('packages/db/src/seed.ts').text()

    expect(schema).toHaveProperty('taskDefinitions')
    expect(schema).toHaveProperty('taskRequests')
    expect(schema).toHaveProperty('taskTransitions')
    expect(schema).toHaveProperty('taskResults')
    expect(schema).toHaveProperty('taskCancellations')

    expect(migration).toContain('create table if not exists task_definitions')
    expect(migration).toContain('create table if not exists task_requests')
    expect(migration).toContain('create table if not exists task_transitions')
    expect(migration).toContain('create table if not exists task_results')
    expect(migration).toContain('create table if not exists task_cancellations')

    expect(serviceEntry).toContain('createDbMTaskStorage')
    expect(adapter).toContain('persistedPolicyDecisionId')
    expect(seed).toContain("delete from role_permissions where permission_id = 'task:assign'")
  })
})
