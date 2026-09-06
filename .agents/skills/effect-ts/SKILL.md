---
name: effect-ts
description: "Write idiomatic Effect v4 TypeScript following official best practices from effect-solutions and the Effect source. Use when writing, reviewing, or refactoring Effect code: services (ServiceMap.Service), layers and dependency injection, error handling (Schema.TaggedErrorClass), data modeling (Schema.Class, branded types, variants), testing (@effect/vitest), HTTP clients (effect/unstable/http), CLI tools (effect/unstable/cli), config, observability, and project setup. Triggers on: 'Effect', 'effect-ts', '@effect/', 'Schema', 'ServiceMap', 'Layer', 'Effect.gen', 'Effect.fn', 'TaggedError', 'branded types', or any Effect-TS related code."
---

# Effect-TS (v4)

Patterns from [effect-solutions](https://effect.solutions) and the [Effect source](https://github.com/effect-ts/effect). This covers the latest v4 APIs.

## Source-First Rule

When working in any repo that uses Effect (`effect` or `@effect/*` in package/dependency files), reference the official Effect source before writing, reviewing, or refactoring Effect code — never stale memory, blog posts, or high-level docs alone. Search the repo-local shallow mirror at `.agent-sources/effect/` (create it before doing Effect work if missing) under `packages/effect/src/` and package tests/examples before calling something an Effect best practice.

See [references/source-mirror.md](references/source-mirror.md) for the mirror bootstrap command, commit hygiene, and local source locations.

## Core Patterns

### Effect.gen and Effect.fn

`Effect.gen` gives sequential, readable composition (async/await style). `Effect.fn` adds call-site tracing and named spans — use it for all service methods; its optional second argument composes cross-cutting concerns (retry, timeout):

```typescript
const program = Effect.gen(function* () {
  const data = yield* fetchData
  yield* Effect.logInfo(`Processing: ${data}`)
  return yield* processData(data)
})

const fetchWithRetry = Effect.fn("fetchWithRetry")(
  function* (url: string) {
    const data = yield* fetchData(url)
    return yield* processData(data)
  },
  flow(Effect.retry(Schedule.recurs(3)), Effect.timeout("5 seconds"))
)
```

See [references/composition-patterns.md](references/composition-patterns.md).

### ServiceMap.Service

Define services as classes with a unique tag and typed interface; implement with `Layer.effect` / `Layer.sync`, wrapping every method in `Effect.fn`.

**Rules:**
- Tag identifiers must be unique. Use `@app/ServiceName` pattern
- Service methods should have `R = never` (dependencies via Layer, not method signatures)
- Use `readonly` properties

See [references/services-and-layers.md](references/services-and-layers.md) for service-driven development, test layers, layer memoization, and full composition patterns.

### Schema.Class and Branded Types

Use `Schema.Class` for domain records. Brand all entity IDs and domain primitives: `Schema.String.pipe(Schema.brand("UserId"))`, construct via `UserId.makeUnsafe("user-123")`. Use `Schema.TaggedClass` + `Schema.Union` for variants (OR types), matched exhaustively with `Match.valueTags`.

See [references/data-modeling.md](references/data-modeling.md) for JSON encoding, Schema.Literals, validation, and full patterns.

### Schema.TaggedErrorClass

Domain errors extend `Schema.TaggedErrorClass`. They are yieldable (no `Effect.fail` needed); recover with `Effect.catchTag` / `Effect.catchTags`:

```typescript
class UserNotFoundError extends Schema.TaggedErrorClass("UserNotFoundError")(
  "UserNotFoundError",
  { userId: UserId, message: Schema.String }
) {}

const getUser = Effect.fn("getUser")(function* (id: UserId) {
  const user = yield* findUser(id)
  if (!user) yield* new UserNotFoundError({ userId: id, message: "Not found" })
  return user
})
```

See [references/error-handling.md](references/error-handling.md) for defects, Schema.Defect, and recovery patterns.

### Layer Composition

Compose layers with `Layer.provideMerge` (incremental, flat types) and `Layer.merge` (parallel); provide once at the app entry:

```typescript
const appLayer = UserService.layer.pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(LoggerLayer),
  Layer.provideMerge(ConfigLayer),
)

const main = program.pipe(Effect.provide(appLayer))
Effect.runPromise(main)
```

**Key rules:**
- Store parameterized layers in constants (layer memoization by reference identity)
- Provide once at app entry, not scattered throughout code
- Use `Layer.sync` for synchronous implementations, `Layer.effect` for effectful ones

See [references/composition-patterns.md](references/composition-patterns.md).

### Testing Quick Start

```typescript
it.effect("queries database", () =>
  Effect.gen(function* () {
    const db = yield* Database
    const results = yield* db.query("SELECT *")
    expect(results.length).toBe(2)
  }).pipe(Effect.provide(Database.testLayer))
)
```

- Use `it.effect` for Effect-based tests (provides TestContext with TestClock); `it.live` for real time / real clock
- Provide fresh layers per test to prevent state leakage; use `it.layer` only when sharing expensive resources across a suite

See [references/testing.md](references/testing.md) for the full worked example and advanced patterns. For timeout/retry/tap/span pipe instrumentation, see [references/composition-patterns.md](references/composition-patterns.md).

## Anti-Patterns

| Do Not | Do Instead |
|--------|-----------|
| `console.log(...)` | `Effect.log(...)` with structured data |
| `process.env.KEY` | `Config.string("KEY")` or `Config.redacted("KEY")` |
| `throw new Error()` inside `Effect.gen` | `yield* new TaggedError({...})` or `Effect.fail(...)` |
| `Effect.runSync(...)` inside services | Keep everything effectful |
| `Effect.catchAll(() => ...)` losing type info | `Effect.catchTag` / `Effect.catchTags` |
| `null` / `undefined` in domain types | `Option<T>` with `Option.match` |
| `Option.getOrThrow(...)` | `Option.match({ onNone, onSome })` or `Option.getOrElse` |
| `Effect.Service` (v3) | `ServiceMap.Service` (v4) |
| `Schema.TaggedError<T>()` (v3) | `Schema.TaggedErrorClass("Tag")("Tag", {...})` (v4) |
| Scatter `Effect.provide` calls | Provide once at app entry |
| Call parameterized layer constructors inline | Store layers in constants (memoization) |

## Reference Files

Load these as needed for deeper patterns:

- **[Source Mirror](references/source-mirror.md)**: source-first rule, `.agent-sources/effect` mirror bootstrap, local source locations
- **[Composition Patterns](references/composition-patterns.md)**: Effect.gen, Effect.fn with cross-cutting concerns, Layer.provideMerge chains, pipe instrumentation
- **[Services & Layers](references/services-and-layers.md)**: ServiceMap.Service, service-driven development, test layers, layer memoization, provide vs provideMerge
- **[Data Modeling](references/data-modeling.md)**: Schema.Class, branded types, variants, Match.valueTags, JSON encoding
- **[Schema Decisions](references/schema-decisions.md)**: Schema.Class vs Struct vs TaggedClass decision flowchart, migration patterns
- **[Error Handling](references/error-handling.md)**: Schema.TaggedErrorClass, catch/catchTag/catchTags, defects, Schema.Defect, TypeId/refail patterns
- **[Testing](references/testing.md)**: @effect/vitest setup, it.effect/it.live/it.layer, TestClock, Effect.flip, FiberRef isolation, worked example
- **[HTTP Clients](references/http-clients.md)**: HttpClient, request building, response decoding, middleware, retries, typed API service
- **[CLI](references/cli.md)**: Command.make, Arguments, Flags, subcommands, worked task manager example
- **[Config](references/config.md)**: Config module, schema validation, ConfigProvider, Redacted, config layers
- **[Processes & Scopes](references/processes.md)**: Fork types, Scope.extend, Command for child processes, killable background tasks
- **[Setup](references/setup.md)**: tsconfig, Effect Language Service, project structure, module settings
