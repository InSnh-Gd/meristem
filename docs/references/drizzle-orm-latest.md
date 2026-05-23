# Drizzle ORM Latest Reference

> Last checked: 2026-05-22. This is a concise project reference, not a copy of upstream docs.  
> Context7 mirror: `/drizzle-team/drizzle-orm-docs` (benchmark 72.5).  
> Round query: 2026-05-22 via Context7 MCP (`resolve-library-id` + `query-docs`).

---

## 1. Current Upstream Snapshot

- Repository: https://github.com/drizzle-team/drizzle-orm
- Official docs: https://orm.drizzle.team
- Drizzle Kit version noted in Context7: `drizzle-kit_0.31.5`
- Drizzle ORM is a lightweight, TypeScript-first ORM for PostgreSQL, MySQL, and SQLite.

---

## 2. Core Concepts

- `pgTable`: defines PostgreSQL tables with column types and constraints.
- `relations()`: defines table relationships enabling relational queries (`db.query.users.findMany({ with: { posts: true } })`).
- `references()`: defines foreign key constraints.
- `primaryKey()`: defines composite primary keys.
- `uniqueIndex()`: defines unique indexes.
- `defaultNow()`: sets timestamp default to current time.
- `withTimezone: true`: stores timezone-aware timestamps.
- `jsonb`: stores JSON data in PostgreSQL binary JSON format.
- `drizzle-kit generate`: generates SQL migration files from schema.
- `drizzle-kit generate --custom --name=seed-users`: creates custom migration files for DDL unsupported by auto-generation or for seed data.

---

## 3. Schema Definition with Relations

```ts
import { pgTable, serial, text, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
})

export const usersRelations = relations(users, ({ many }) => ({
  posts: many(posts),
}))

export const posts = pgTable('posts', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  authorId: integer('author_id').notNull(),
})

export const postsRelations = relations(posts, ({ one }) => ({
  author: one(users, { fields: [posts.authorId], references: [users.id] }),
}))
```

---

## 4. Relational Query

```ts
import * as schema from './schema'
import { drizzle } from 'drizzle-orm/...'

const db = drizzle(client, { schema })

const result = await db.query.users.findMany({
  with: { posts: true },
})
```

---

## 5. Meristem Usage

Meristem uses Drizzle ORM for the PostgreSQL authoritative write model (ADR-010).

Current schema: `packages/db/src/schema.ts`

**Meristem 现状 (2026-05-22)**:
- Schema uses `pgTable`, `references`, `primaryKey`, `uniqueIndex` ✅
- `defaultNow()` and `withTimezone: true` used correctly ✅
- `relations()` not defined ❌
- `drizzle-orm@latest` in `package.json` ⚠️ should pin
- `drizzle-kit@latest` in `package.json` ⚠️ should pin
- Indexes only on `networks` table; other tables lack query optimization indexes ❌

**建议**:
- Add `relations()` definitions for tables with foreign keys (e.g. `nodes` -> `node_credentials`, `networks` -> `network_memberships`).
- Pin `drizzle-orm` and `drizzle-kit` to exact versions.
- Add indexes on frequently queried columns (`nodes.id`, `tasks.leaf_node_id`, `audit_logs.actor`, etc.).

---

## 6. Migration Best Practices

```bash
# Generate migration from schema
bunx drizzle-kit generate

# Create custom migration for seed data
bunx drizzle-kit generate --custom --name=seed-users
```

Custom migrations are stored alongside auto-generated ones in the `drizzle/` directory.

---

## 7. Version Pinning Note

Drizzle ORM and Drizzle Kit release independently.  
Pin both to exact versions to avoid schema/migration drift.

---

## 8. Sources

- Drizzle ORM repository: https://github.com/drizzle-team/drizzle-orm
- Drizzle ORM docs: https://orm.drizzle.team
- Context7 mirrors:
  - `/drizzle-team/drizzle-orm-docs` (benchmark 72.5)
  - `/drizzle-team/drizzle-orm` (benchmark 88)

## 9. Context7 Query Log (2026-05-22)

| Topic | Context7 libraryId | Key findings |
|-------|-------------------|--------------|
| Schema + relations | `/drizzle-team/drizzle-orm-docs` | `relations()` + `pgTable` + `references` pattern |
| Migration generation | `/drizzle-team/drizzle-orm-docs` | `drizzle-kit generate` and `--custom` for seed |
| Relational queries | `/drizzle-team/drizzle-orm-docs` | `db.query.users.findMany({ with: { posts: true } })` |
| PostgreSQL schema | `/drizzle-team/drizzle-orm-docs` | `pgTable`, `defaultNow()`, `withTimezone` |

**Context7 usage notes**:
- Requires `POST` + `Accept: application/json, text/event-stream`
- Returns SSE format (`event: message\ndata: {...}`)
- Does not support `resources/list`; only exposes `tools` (`resolve-library-id`, `query-docs`)
