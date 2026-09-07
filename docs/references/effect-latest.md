# Effect Latest Reference

> Last updated: 2026-08-27. This is a concise project reference, not a copy of upstream docs.
> Context7 mirror: `/effect-ts/effect` (benchmark 75), `/llmstxt/effect_website_llms_txt` (benchmark 87.3).
> Repository dependency status: `effect@4.0.0-rc.112` and `@effect/platform-bun@4.0.0-rc.112` installed (accepted RC migration in progress, not final stable). Standalone `@effect/platform` is removed.

---

## 1. Upstream Snapshot & Installed Version

- Repository: https://github.com/effect-ts/effect
- Official docs: https://effect.website
- Upstream status: Effect 4.x line is under active release candidate stabilization.
- Repository status: Installed dependencies are frozen at `effect@4.0.0-rc.112` and `@effect/platform-bun@4.0.0-rc.112` during the v4 migration. Standalone `@effect/platform` is removed in favor of direct `@effect/platform-bun` for Bun runtime integration.

---

## 2. Core Concepts & v4 Schema Patterns

- **Effect**: A value representing an execution workflow that may fail with typed errors, succeed, manage resources, or require contextual services.
- **Effect.Service**: Class-based service definition with integrated `Layer` / `Default` tags.
- **Layer**: Service implementation provider; composed at application startup via `Layer.provide`.
- **Effect.gen**: Generator-based composition for multi-step workflows.
- **Error Channel**: `Effect.fail`, `Data.TaggedError`, `Effect.catchTag` / `Effect.catchTags` / `Effect.catchAll`.
- **Resource Management**: `Effect.acquireRelease` + `Scope` for deterministic cleanup.
- **Native Schema v4 Patterns** (verified in repo):
  - Multi-value literals: `Schema.Literals(['val1', 'val2'])`
  - Positional record definition: `Schema.Record(Schema.String, ValueSchema)`
  - Predicate filter / refinement: `.pipe(Schema.check(Schema.makeFilter((val) => condition)))`
  - Boundary decode: `Schema.decodeUnknownSync` and `Schema.decodeUnknownExit` (never unchecked `as` casts across service boundaries).

---

## 3. Effect.Service Pattern (Recommended)

```ts
import { Effect, Ref } from "effect"

class UserRepository extends Effect.Service<UserRepository>()("UserRepository", {
  effect: Effect.gen(function* () {
    const ref = yield* Ref.make<Array<{ id: string; name: string }>>([])
    return {
      findMany: Ref.get(ref),
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
```

---

## 4. HTTP & Boundary Orchestration in Meristem

- **HTTP Routing**: Meristem routes are served by ElysiaJS (not `@effect/platform` HTTP server).
- **Workflow Invocation**: Elysia route handlers validate input with TypeBox, call Effect workflows at the boundary, and map typed errors to standard HTTP response envelopes.
- **Platform Runtime**: `@effect/platform-bun` is used for Bun platform runtime smoke/pilot capabilities.

---

## 5. Meristem Usage ([ADR-F01](../adr/ADR-F01-foundational-technology-stack.md))

Use Effect where complexity justifies it:

- Service lifecycle orchestration
- Event consumers
- M-Policy decision flows
- M-Log pipelines
- Retries, timeouts, cancellation
- Resource management
- Multi-service orchestration

Do **not** wrap simple data mapping, synchronous utilities, or basic CRUD into Effect.

---

## 6. Dependency & Migration Note

- Current installation: `effect@4.0.0-rc.112` and `@effect/platform-bun@4.0.0-rc.112`.
- RC status: Migration remains in progress; guidance reflects accepted RC patterns rather than assuming finalized stable v4 APIs.
- Standalone `@effect/platform` is removed; all platform imports use `@effect/platform-bun`.

---

## 7. Historical Context & Query Log (Non-Authoritative)

> Note: The 2026-05-22 Context7 query log below reflects earlier Effect 3.x baseline exploration and is preserved for provenance only. Active development is governed by the 4.0.0-rc.112 guidance above.

| Topic | Context7 libraryId | Historical finding (3.x) |
|-------|-------------------|--------------------------|
| HTTP error handling | `/effect-ts/effect` | `catchTags` + `catchAllCause` in `@effect/platform` routes |
| Service DI | `/effect-ts/effect` | `Effect.Service` + `Layer.provide` pattern |
| RPC handlers | `/effect-ts/effect` | `Effect.gen` + `Ref` for in-memory state |
| Cookie validation | `/effect-ts/effect` | `HttpServerRequest.schemaCookies` + `Schema.Struct` |
| Route params | `/effect-ts/effect` | `HttpRouter.schemaPathParams` + `Schema.Struct` |
