# Composition Patterns

## Table of Contents

- [Effect.gen](#effectgen)
- [Effect.fn](#effectfn)
- [Layer Composition](#layer-composition)
- [Pipe for Instrumentation](#pipe-for-instrumentation)

## Effect.gen

`Effect.gen` provides sequential, readable composition (like async/await for Effect):

```typescript
import { Effect } from "effect"

const program = Effect.gen(function* () {
  const data = yield* fetchData
  yield* Effect.logInfo(`Processing: ${data}`)
  return yield* processData(data)
})
```

## Effect.fn

`Effect.fn` adds call-site tracing and named spans. Use for all service methods:

```typescript
const processUser = Effect.fn("processUser")(function* (userId: string) {
  yield* Effect.logInfo(`Processing user ${userId}`)
  const user = yield* getUser(userId)
  return yield* processData(user)
})

// Second argument for cross-cutting concerns (retry, timeout)
const fetchWithRetry = Effect.fn("fetchWithRetry")(
  function* (url: string) {
    const data = yield* fetchData(url)
    return yield* processData(data)
  },
  flow(
    Effect.retry(Schedule.recurs(3)),
    Effect.timeout("5 seconds")
  )
)
```

## Layer Composition

Compose layers with `Layer.provideMerge` (incremental, flat types) and `Layer.merge` (parallel):

```typescript
import { Effect, Layer } from "effect"

// Compose layers for the app
const appLayer = UserService.layer.pipe(
  Layer.provideMerge(DatabaseLayer),
  Layer.provideMerge(LoggerLayer),
  Layer.provideMerge(ConfigLayer),
)

// Provide once at the entry point
const main = program.pipe(Effect.provide(appLayer))
Effect.runPromise(main)
```

**Key rules:**
- Store parameterized layers in constants (layer memoization by reference identity)
- Provide once at app entry, not scattered throughout code
- Use `Layer.sync` for synchronous implementations, `Layer.effect` for effectful ones

See [services-and-layers.md](services-and-layers.md) for service-driven development, test layers, layer memoization, and full composition patterns.

## Pipe for Instrumentation

```typescript
const program = fetchData.pipe(
  Effect.timeout("5 seconds"),
  Effect.retry(Schedule.exponential("100 millis").pipe(
    Schedule.compose(Schedule.recurs(3))
  )),
  Effect.tap((data) => Effect.logInfo(`Fetched: ${data}`)),
  Effect.withSpan("fetchData"),
)
```
