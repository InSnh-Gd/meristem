# Eden MVP Contract

> Eden is the preferred internal TypeScript contract. MVP requires one status contract and may grow from there.

---

## 1. Package Boundary

Target package:

```text
packages/contracts/
```

Initial exported contract:

```ts
export const coreContract = {
  status: "GET /api/v0/status",
  health: "GET /api/v0/health",
  ready: "GET /api/v0/ready",
} as const;
```

The concrete Elysia/Eden implementation may differ, but the exported TypeScript client must expose equivalent typed calls.

---

## 2. Required Typed Calls

```ts
type CoreClient = {
  health(): Promise<HealthResponse>;
  ready(): Promise<ReadyResponse>;
  status(actor: ActorContext): Promise<StatusResponse>;
};
```

`HealthResponse`, `ReadyResponse`, and `StatusResponse` are defined in `docs/contracts/REST-API-MVP.md`.

---

## 3. Rules

- Eden contracts are internal TS contracts only.
- External users rely on REST + OpenAPI.
- Eden types must not use `any`.
- Eden contract tests must fail when REST response shape changes incompatibly.
- Eden contract version follows package semver.

---

## 4. MVP Acceptance

- Core exposes the status contract.
- CLI can use either REST directly or the generated Eden client.
- Contract test verifies `status()` returns Core mode, dependency readiness, and counts.
