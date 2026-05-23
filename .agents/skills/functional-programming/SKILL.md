---
name: functional-programming
description: Use when designing or implementing TypeScript domain logic, policy checks, parsers, validators, state transitions, event handling, error modeling, or Effect-based workflows where purity and explicit side effects matter.
---

# Functional Programming

## Core Rules

- Prefer pure functions for domain logic: same input, same output, no hidden I/O.
- Keep side effects at boundaries: HTTP handlers, database adapters, event publishers, log writers.
- Model state transitions as data transformations before wiring persistence.
- Return explicit results for expected failures instead of throwing deep inside domain code.
- Use immutable updates; avoid mutating shared objects.
- Make invalid states unrepresentable with discriminated unions and narrow types.

## Meristem Defaults

- Policy decisions, event envelope validation, config lifecycle, service definition validation, and log classification should be pure-first.
- Elysia handlers should orchestrate: parse input, call pure logic, persist/publish/log through adapters.
- Effect is the default choice for complex resource/lifecycle/event workflows, retries, timeout/cancellation, and multi-service orchestration; it is not for every simple function.
- `unknown` plus schema/type guards is preferred over `any`.

## Result Pattern

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E }

const allow = <T>(value: T): Result<T, never> => ({ ok: true, value })
const deny = <E>(error: E): Result<never, E> => ({ ok: false, error })
```

## Boundary Pattern

```ts
// Pure domain logic
export function decidePermission(input: PolicyInput): PolicyDecision {
  // no database, no HTTP, no logs
}

// Effectful boundary
export async function handleRequest(ctx: RequestContext) {
  const decision = decidePermission(ctx.policyInput)
  await ctx.audit.write(decision)
  return decision
}
```

## Common Mistakes

- Hiding database reads inside validators.
- Throwing for ordinary deny/invalid outcomes.
- Mutating event payloads after validation.
- Using Effect for trivial mapping code.
- Returning booleans where a decision needs reasons, actor, action, and resource.
