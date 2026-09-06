import type { SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'

/**
 * drizzle 动态表列访问辅助。
 *
 * 投影 factTables 按运行时键选择联合表类型，TypeScript 无法静态证明给定键是合法列名，
 * 需要绕过列类型检查 —— 这是 MERISTEM-DEV §8.1 认可的 ORM 限制例外；
 * 双断言统一收敛到本文件并在此说明，禁止在调用点散落。
 */
export function columnOf<Table extends object>(table: Table, key: string): PgColumn {
  return table[key as keyof Table] as PgColumn
}

export function sqlChunkOf<Table extends object>(table: Table, key: string): SQL<unknown> {
  return table[key as keyof Table] as unknown as SQL<unknown>
}
