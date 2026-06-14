import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

/**
 * PostgreSQL 连接入口集中在这里，便于所有进程共享同一默认连接串和连接池参数。
 */
export function createSqlClient(
  databaseUrl = process.env.DATABASE_URL ?? 'postgres://meristem:meristem@localhost:55432/meristem'
) {
  return postgres(databaseUrl, { max: 5 })
}

/**
 * Drizzle 与底层 postgres client 一起返回，调用方可同时拿到权威写模型和连接生命周期控制。
 */
export function createDb(databaseUrl?: string) {
  const client = createSqlClient(databaseUrl)
  return {
    client,
    db: drizzle(client, { schema })
  }
}

// MeristemDb 用于在不暴露具体连接工厂实现的前提下共享数据库类型。
export type MeristemDb = ReturnType<typeof createDb>['db']
