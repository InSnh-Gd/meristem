# Effect Latest Reference

> Last checked: 2026-05-22. This is a concise project reference, not a copy of upstream docs.  
> Context7 mirror: `/effect-ts/effect` (benchmark 75), `/llmstxt/effect_website_llms_txt` (benchmark 87.3).  
> Round query: 2026-05-22 via Context7 MCP (`resolve-library-id` + `query-docs`).

---

## 1. Current Upstream Snapshot

- Repository: https://github.com/effect-ts/effect
- Official docs: https://effect.website
- Effect is a TypeScript library for type-safe, composable applications with powerful abstractions for concurrency, error handling, and dependency injection.
- Current major line: 3.x (codebase pinned to `3.21.2` as of 2026-05-22).

---

## 2. Core Concepts

- **Effect**: a value that represents a computation that may fail, succeed, require resources, or depend on services.
- **Effect.Service**: a class-based API for defining services with built-in `Layer` and `Default` support (new recommended way).
- **Layer**: provides service implementations; composes with `Layer.provide` for dependency injection.
- **Effect.gen**: generator-based composition for complex workflows with multiple steps, branches, and error handling.
- **Effect.catchTags / Effect.catchAllCause**: type-safe error handling by error tag or cause.
- **Effect.tryPromise**: wraps Promise-throwing code into Effect.
- **Schema**: runtime type validation integrated with Effect ( `@effect/schema` ).
- **@effect/platform**: HTTP routing, middleware, and server abstractions.

---

## 3. Effect.Service Pattern (Recommended)

```ts
import { Effect } from "effect"

class UserRepository extends Effect.Service<UserRepository>()("UserRepository", {
  effect: Effect.gen(function* () {
    const ref = yield* Ref.make<Array<User>>([])
    return {
      findMany: ref.get,
      findById: (id: string) =>
        Ref.get(ref).pipe(
          Effect.andThen((users) => {
            const user = users.find((u) => u.id === id)
            return user
              ? Effect.succeed(user)
              : Effect.fail(`User not found: ${id}`)
          })
        ),
    }
  })
}) {}

// Usage
const program = Effect.gen(function* () {
  const repo = yield* UserRepository
  const user = yield* repo.findById("1")
  return user
}).pipe(
  Effect.catchAll((e) => Effect.succeed(null))
)
```

---

## 4. HTTP Route Error Handling with Effect

```ts
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"
import { Effect } from "effect"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/throw", Effect.sync(() => { throw new Error("BROKEN") })),
  HttpRouter.get("/fail", Effect.fail("Uh oh!"))
)

const app = router.pipe(
  Effect.catchTags({
    RouteNotFound: () => HttpServerResponse.text("Route Not Found", { status: 404 })
  }),
  Effect.catchAllCause((cause) =>
    HttpServerResponse.text(cause.toString(), { status: 500 })
  ),
  HttpServer.serve()
)
```

---

## 5. Meristem Usage ([ADR-F01](../adr/ADR-F01-foundational-technology-stack.md))

Use Effect where complexity justifies it:

- service lifecycle orchestration
- event consumers
- M-Policy decision flows
- M-Log pipelines
- retries, timeouts, cancellation
- resource management
- multi-service orchestration

Do **not** require all simple code to become Effect-based.

## 6. Version Pinning Note

Effect releases frequently. Minor versions may introduce new APIs (`Effect.Service` was added in a recent 3.x).  
Pin `effect` to exact version; run `bun outdated effect` periodically.

---

## 7. Sources

- Effect repository: https://github.com/effect-ts/effect
- Effect official docs: https://effect.website
- Context7 mirrors:
  - `/effect-ts/effect` (benchmark 75)
  - `/llmstxt/effect_website_llms_txt` (benchmark 87.3)
  - `/llmstxt/effect_website_llms-full_txt` (benchmark 77.5)

## 8. Context7 Query Log (2026-05-22)

| Topic | Context7 libraryId | Key findings |
|-------|-------------------|--------------|
| HTTP error handling | `/effect-ts/effect` | `catchTags` + `catchAllCause` in `@effect/platform` routes |
| Service DI | `/effect-ts/effect` | `Effect.Service` + `Layer.provide` pattern |
| RPC handlers | `/effect-ts/effect` | `Effect.gen` + `Ref` for in-memory state |
| Cookie validation | `/effect-ts/effect` | `HttpServerRequest.schemaCookies` + `Schema.Struct` |
| Route params | `/effect-ts/effect` | `HttpRouter.schemaPathParams` + `Schema.Struct` |

**Context7 usage notes**:
- Requires `POST` + `Accept: application/json, text/event-stream`
- Returns SSE format (`event: message\ndata: {...}`)
- Does not support `resources/list`; only exposes `tools` (`resolve-library-id`, `query-docs`)
