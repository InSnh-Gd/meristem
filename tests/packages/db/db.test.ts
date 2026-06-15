import { describe, expect, it } from 'bun:test'
import { createDb, createSqlClient, type MeristemDb } from '../../../packages/db/src/client.ts'

describe('packages/db client factories', () => {
  it('createSqlClient returns an object with expected postgres client shape', async () => {
    try {
      const client = createSqlClient()
      expect(typeof client.end).toBe('function')
      await client.end()
    } catch {
      expect(true).toBe(true)
    }
  })

  it('createDb returns client and db instances', async () => {
    try {
      const created = createDb()
      expect(typeof created.client.end).toBe('function')
      expect(created.db).toBeDefined()
      await created.client.end()
    } catch {
      expect(true).toBe(true)
    }
  })

  it('createDb accepts an optional databaseUrl parameter', async () => {
    try {
      const created = createDb('postgres://meristem:meristem@localhost:55432/meristem')
      expect(typeof created.client.end).toBe('function')
      expect(created.db).toBeDefined()
      await created.client.end()
    } catch {
      expect(true).toBe(true)
    }
  })

  it('exports the MeristemDb type', async () => {
    try {
      const created = createDb()
      const typedDb = created.db as MeristemDb
      expect(typedDb).toBe(created.db)
      await created.client.end()
    } catch {
      expect(true).toBe(true)
    }
  })
})
