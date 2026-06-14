# Task 7 — DB ownership enforcement

- Goal: finalize the DB ownership allowlist check after the schema split.
- Scope: accept imports from `packages/db/src/schema.ts` and `packages/db/src/schema/<owner>.ts` while preserving the approved cross-owner reads.
- Notes: current approved exceptions remain unchanged; the check stays a closure/audit guard only.

## Verification log

- `bun run db:ownership-check --enforce` ✅ `db ownership check: no unapproved cross-owner table reads found`
- `bun test tests/contracts/db-ownership-check.fixture.test.ts` ✅ `3 pass`
- `bun run typecheck` ✅ passed
- `bun run lint` ⚠️ blocked by existing unrelated warnings in `tests/contracts/postgres-schema-doc-drift.contract.test.ts` and `packages/db/src/schema/core.ts`; ownership check is intentionally not wired into lint until that debt is cleared
- `package.json` now exposes `db:ownership-check` as an independent script: `bun run db:ownership-check --enforce`
- Import coverage now accepts both `packages/db/src/schema.ts` and owner modules such as `packages/db/src/schema/core.ts` and `packages/db/src/schema/policy.ts`

## Approved exceptions

- `services/m-task/src/storage-adapter.ts` → `policyDecisions`
- `services/m-task/src/suspended-operations.ts` → `policyDecisions`
- `apps/core/src/adapters/auth.ts` → `userRoles`, `rolePermissions`
- `services/m-net/src/agent-runtime-task-dispatch.ts` → `nodes`
- `services/m-net/src/network-service.ts` → `nodes`
- `services/m-net/src/shared.ts` → `nodes`
- `services/m-net/src/agent-runtime-session-lifecycle.ts` → `nodes`, `nodeCredentials`, `nodeJoinTickets`
