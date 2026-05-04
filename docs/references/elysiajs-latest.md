# ElysiaJS Latest Reference

> Last checked: 2026-05-04. This is a concise project reference, not a copy of upstream docs.

---

## 1. Current Upstream Snapshot

- Latest GitHub release checked: `elysia@1.4.28`, published 2026-03-16.
- Official docs: https://elysiajs.com
- Official docs repo: https://github.com/elysiajs/documentation
- Official framework repo: https://github.com/elysiajs/elysia
- OpenAPI plugin docs/package: https://github.com/elysiajs/elysia-openapi
- Eden client repo/package: https://github.com/elysiajs/eden

Release `1.4.28` includes stream response/backpressure work, range handling for file/blob responses, and multiple route/schema/cookie/parser fixes. Treat it as the current release target unless the project pins a different version.

---

## 2. Core Concepts

- Elysia is a TypeScript web framework centered on typed route contracts.
- Route handlers can validate `body`, `params`, `query`, `headers`, cookies, and responses using `t` schemas.
- Plugins compose applications and feature modules.
- Lifecycle hooks such as request, before-handle, after-handle, and error handling are part of app organization.
- Eden provides type-safe internal TypeScript clients from the server app type.
- OpenAPI/Swagger plugins generate API documentation from route schemas.

---

## 3. Meristem Usage

Use Elysia for:

- Core REST API.
- OpenAPI v0 generation.
- internal Eden sample contract.
- service lifecycle routes.
- node registration and task assignment endpoints.
- policy/audit-aware route composition.

Do not use Elysia to hide:

- policy decisions inside anonymous handlers.
- Audit Log writes inside untestable hooks.
- cross-service coupling through private objects.

---

## 4. Minimal Pattern

```ts
import { Elysia, t } from 'elysia'
import { openapi } from '@elysiajs/openapi'

export const app = new Elysia()
  .use(openapi())
  .get('/api/v0/health', () => ({ ok: true }))
  .post(
    '/api/v0/nodes',
    async ({ body, status }) => {
      if (body.kind === 'core') return status(400, { error: 'unsupported kind' })
      return { node: body }
    },
    {
      body: t.Object({
        kind: t.Union([t.Literal('stem'), t.Literal('leaf')]),
        name: t.String({ minLength: 1 })
      })
    }
  )
```

---

## 5. Testing Pattern

```ts
const response = await app.handle(
  new Request('http://localhost/api/v0/health')
)

expect(response.status).toBe(200)
expect(await response.json()).toEqual({ ok: true })
```

Use this style for route-level tests before relying on a live server.

---

## 6. Sources

- Elysia official docs: https://elysiajs.com
- Elysia documentation repository: https://github.com/elysiajs/documentation
- Elysia release `1.4.28`: https://github.com/elysiajs/elysia/releases/tag/1.4.28
- Context7 official-doc mirror used for route, lifecycle, OpenAPI, Eden, and testing examples: `/elysiajs/documentation`
