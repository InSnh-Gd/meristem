import { describe, expect, it } from 'bun:test'

describe('M-Extension PostgreSQL schema documentation contract', () => {
  it('documents M-Extension authoritative tables and seeded permissions', async () => {
    const doc = await Bun.file('docs/data/POSTGRES-SCHEMA-MVP.md').text()

    for (const table of ['extension_definitions', 'extension_instances', 'extension_transitions']) {
      expect(doc).toContain(table)
    }

    for (const permission of [
      'extension:read',
      'extension:register',
      'extension:enable',
      'extension:disable'
    ]) {
      expect(doc).toContain(permission)
    }

    expect(doc).toContain('M-Extension')
    expect(doc).toContain('system/default')
  })
})
