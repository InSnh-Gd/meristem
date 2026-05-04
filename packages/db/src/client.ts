import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export function createSqlClient(databaseUrl = process.env.DATABASE_URL ?? 'postgres://meristem:meristem@localhost:55432/meristem') {
  return postgres(databaseUrl, { max: 5 })
}

export function createDb(databaseUrl?: string) {
  const client = createSqlClient(databaseUrl)
  return {
    client,
    db: drizzle(client, { schema })
  }
}

export type MeristemDb = ReturnType<typeof createDb>['db']
