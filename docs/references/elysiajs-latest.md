# ElysiaJS Latest Reference

> Last checked: 2026-05-22. This is a concise project reference, not a copy of upstream docs.  
> Context7 mirror: `/elysiajs/documentation` (benchmark 90.1).  
> Round query: 2026-05-22 via Context7 MCP (`resolve-library-id` + `query-docs`).

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
- `.error()` registers custom error classes for type-safe error handling.
- `.onError()` provides a global error hook for validation, not-found, and custom errors.
- `status(code, body)` returns a response with a specific HTTP status code.
- Valibot and TypeBox are both supported for schema validation.

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

## 5. Error Handling Pattern

Elysia 1.4.28 supports custom error classes and a global `onError` hook.  
The `.error()` method registers type-safe custom errors; `.onError()` catches them by `code`.

```ts
class AuthError extends Error {
  status = 401
  constructor(message: string) { super(message) }
}

new Elysia()
  .error({ AuthError })
  .onError(({ code, error, status }) => {
    switch (code) {
      case 'AuthError':
        return { error: error.message, code: 'AUTH_FAILED' }
      case 'VALIDATION':
        return status(400, { error: error.message })
      case 'NOT_FOUND':
        return status(404, { error: 'Route not found' })
      default:
        return status(500, { error: 'Internal server error' })
    }
  })
  .get('/protected', ({ headers }) => {
    if (!headers.authorization) throw new AuthError('Missing authorization')
    return 'Secret data'
  })
```

Validation errors can be caught with `code === 'VALIDATION'` and `error.all()` for field-level detail:

```ts
.onError(({ code, error, set }) => {
  if (code === 'VALIDATION') {
    set.status = 400
    return { fields: error.all() }
  }
})
```

**Meristem 现状 (2026-05-22)**: 代码库未使用 `.error()` 和 `.onError()`；每个 handler 手动调用 `apiError(status, ...)`。  
**建议**: 在 `apps/core/src/app.ts` 注册全局 `.error()` + `.onError()`，统一错误响应格式。

---

## 6. Testing Pattern

```ts
const response = await app.handle(
  new Request('http://localhost/api/v0/health')
)

expect(response.status).toBe(200)
expect(await response.json()).toEqual({ ok: true })
```

Use this style for route-level tests before relying on a live server.

---

## 7. Version Pinning Note

Elysia and its plugin ecosystem release on independent cadences.  
`@elysiajs/openapi`, `@elysiajs/eden`, `@elysiajs/cors` may introduce breaking changes across minor versions.

Recommendation: pin all Elysia-family packages to exact versions in `package.json`.

---

## 8. Sources

- Elysia official docs: https://elysiajs.com
- Elysia documentation repository: https://github.com/elysiajs/documentation
- Elysia release `1.4.28`: https://github.com/elysiajs/elysia/releases/tag/1.4.28
- Context7 official-doc mirror: `/elysiajs/documentation` (benchmark 90.1)
- Context7 OpenAPI plugin mirror: `/elysiajs/elysia-openapi`

## 9. Context7 Query Log (2026-05-22)

| Topic | Context7 libraryId | Key findings |
|-------|-------------------|--------------|
| Version & features | `/elysiajs/documentation` | `elysia@1.4.28` (2026-03-16); stream/backpressure/range fixes |
| Error handling | `/elysiajs/documentation` | `.error()` + `.onError()` for type-safe custom errors |
| Validation | `/elysiajs/documentation` | TypeBox (`t.String()`) and Valibot (`v.string()`) both supported |
| Testing | `/elysiajs/documentation` | `app.handle(new Request(...))` no server needed |

**Context7 usage notes**:
- Requires `POST` + `Accept: application/json, text/event-stream`
- Returns SSE format (`event: message\ndata: {...}`)
- Does not support `resources/list`; only exposes `tools` (`resolve-library-id`, `query-docs`)
