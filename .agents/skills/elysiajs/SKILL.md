---
name: elysiajs
description: Use when implementing, reviewing, or documenting ElysiaJS services, routes, plugins, validation schemas, OpenAPI output, Eden clients, or Elysia tests in a TypeScript/Bun backend.
---

# ElysiaJS

## Core Rules

- Keep Elysia apps TypeScript-first: route schemas define runtime validation and inferred types.
- Prefer small composable plugins over large route files.
- Use `t` schemas for `body`, `params`, `query`, `headers`, `cookie`, and response contracts.
- Export `typeof app` when an Eden client needs end-to-end type safety.
- Treat REST/OpenAPI as the external contract and Eden as an internal TypeScript contract.
- Test routes through `app.handle(new Request(...))` before relying on a running server.

## Meristem Defaults

- Core API uses Elysia for REST + OpenAPI.
- Internal TypeScript calls may use Eden, but external boundaries remain REST + OpenAPI.
- Elysia method chains need comments when authentication, policy, audit, or lifecycle behavior is not obvious.
- Protected routes must call M-Policy and write M-Log/Audit according to the docs.
- Use OpenAPI metadata to expose permission requirements for protected MVP endpoints.

## Patterns

```ts
import { Elysia, t } from 'elysia'

export const app = new Elysia()
  .get('/health', () => ({ ok: true }))
  .post(
    '/nodes',
    ({ body }) => ({ node: body }),
    {
      body: t.Object({
        kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
        name: t.String({ minLength: 1 })
      })
    }
  )
```

## When More Detail Is Needed

Read `../../../docs/references/elysiajs-latest.md` for the current project snapshot, official links, release notes, and Meristem-specific usage guidance.

## Common Mistakes

- Defining TypeScript interfaces but skipping runtime schemas.
- Using Eden as an external public API contract.
- Mixing policy, audit, and handler logic without readable boundaries.
- Testing only through a live port instead of `app.handle`.
