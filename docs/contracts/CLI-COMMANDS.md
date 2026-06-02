# CLI Commands MVP Contract

> M-CLI is the primary MVP operator entrypoint. Commands call Core APIs and must return non-zero exit codes on failure.

---

## 1. Global Rules

- Binary name: `meristem`.
- Default Core URL: `http://localhost:3000`.
- Core URL can be overridden by `MERISTEM_CORE_URL`.
- Follow-on service URLs can be overridden by service-specific environment variables such as `MERISTEM_TASK_URL`, `MERISTEM_POLICY_URL`, `MERISTEM_MNET_URL`, and `MERISTEM_EXTENSION_URL` when a command is owned by an external M-* service.
- Actor is selected by a locally signed JWT in `MERISTEM_TOKEN`.
- Output defaults to human-readable text.
- `--json` returns JSON for scripts.
- Failed command exits non-zero and prints a short error with correlationId if available.

---

## 2. Commands

### `meristem status`

Permission: `core:read`.

Shows:

- Core version
- mode
- PostgreSQL readiness
- NATS readiness
- node count
- service count
- task count

### `meristem node register --kind stem|leaf --name <name> [--mode simulated]`

Permission: `node:register`.

Registers a Stem or Leaf node and prints node ID.

Rules:

- `--kind core` is not supported in MVP.
- default mode is `simulated`.
- `--mode simulated` keeps the legacy in-process noop path.
- `--mode agent` is rejected; use `meristem node ticket create` instead.
- `simulated` registrations stay on the current synchronous `healthy` path.

### `meristem node ticket create --kind stem|leaf --name <name> [--expires <seconds>]`

Permission: `node:register`.

Creates a one-time Join Ticket for an agent node and prints `ticket`, `expiresAt`, and `joinUrl`.

Rules:

- the ticket is single-use and short-lived.
- `joinUrl` points to the public M-Net ingress `wss://<host>:8443/join/v0/session`.
- after the first successful join, the agent should resume with the runtime token returned by `join.accepted` and keep using the active `sessionId` for steady-state frames.

### `meristem node issue-token --node <node-id>`

Permission: `node:issue-token`.

Issues or rotates the per-node agent token for one node.

Rules:

- token plaintext is returned once and must not be logged.
- re-issuing a token revokes the previous active token for that node.
- only one active token exists per node in MVP.
- this command is a compatibility path, not the primary public node-join flow.

### `meristem node list`

Permission: `core:read`.

Lists node ID, kind, name, status, and createdAt.

The current MVP response also includes:

- `mode`
- `reachability`
- `lastSeenAt`
- `agentVersion`

### `meristem network create --name <name> [--profile <profileVersion>]`

Permission: `network:create`.

Creates one logical node network and prints network ID.

Rules:

- `--profile` defaults to `m-net-default@0.1.0`.
- network name must be unique.

### `meristem network list`

Permission: `network:read`.

Lists network ID, name, profileVersion, status, and memberCount.

### `meristem network join --network <network-id> --node <node-id>`

Permission: `network:join`.

Adds a registered node to a logical network.

Rules:

- target network must exist.
- target node must exist and be `healthy`.
- leaf joins stay restricted.
- leaf joins require an existing stem member in the same network.

### `meristem network members --network <network-id>`

Permission: `network:read`.

Lists network members with node kind, membership mode, and joined time.

### `meristem network profile list`

Permission: `network:profile-read`.

Lists available Regional Network Profile definitions.

Rules:

- uses `MERISTEM_MNET_URL` when set.
- routes through M-Net, not Core.

### `meristem network profile show <profile-version>`

Permission: `network:profile-read`.

Shows one Regional Network Profile definition with its rules and capabilities.

### `meristem network profile enable --network <network-id> --profile m-net-cn@0.1.0 --reason <text>`

Permission: `network:profile-enable`.

Requests enabling M-Net CN on one logical network.

Rules:

- uses `MERISTEM_MNET_URL` when set.
- enable requires Phase 12 approval; the command returns a pending approval with `approvalId` and `operationId`.
- the security-admin must approve through `meristem policy approvals approve` before the profile is applied.
- non-zero exit on missing permission, invalid network, or unsupported profile version.

### `meristem network profile disable --network <network-id> --reason <text>`

Permission: `network:profile-disable`.

Disables M-Net CN on one network and rolls back to `m-net-default@0.1.0`.

Rules:

- uses `MERISTEM_MNET_URL` when set.
- disable is immediate with M-Policy allow + Audit; no approval is required.
- disable is allowed from `failed` state as a recovery path.
- non-zero exit on missing permission, network not found, or profile not enabled (`409 profile.not_enabled`).

### `meristem task submit --node <node-id> --type noop`

Permission: `task:submit`.

Submits a Phase 11 noop task through M-Task against a Leaf node.

Rules:

- only `noop` is supported in MVP.
- target node must be a Leaf.
- M-Task owns the task state, risk decision, task events, and task log behavior.
- `agent` noop delivery goes through M-Task -> M-Net -> active join-ingress session `task.execute` -> agent `task.result`.

### `meristem task status <task-id>`

Permission: `task:read`.

Returns one M-Task task record.

### `meristem task list`

Permission: `task:read`.

Lists M-Task task records.

### `meristem task cancel <task-id>`

Permission: `task:cancel`.

Requests M-Task cancellation. Queued tasks cancel locally; dispatched or running tasks use best-effort M-Net cancellation.

### `meristem task retry <task-id>`

Permission: `task:retry`.

Runs auth, RBAC, and risk checks, then returns `not_implemented_yet` when policy allows the retry request.

### `meristem service list`

Permission: `core:read`.

Lists built-in service summaries and any registered service definitions visible through Core.

### `meristem service reload --service <service-id> [--reason <text>]`

Permission: `service:reload`.

Requests a synchronous reload against a reloadable service prototype.

Rules:

- `m-log` is the only reloadable built-in service in the current prototype.
- non-reloadable services return `409`.
- unknown services return `404`.
- `--reason` is optional and is forwarded to the internal lifecycle endpoint.

### `meristem extension list`

Permission: `extension:read`.

Lists Phase 15 extension definitions and system-scoped instance state through M-Extension.

Rules:

- uses `MERISTEM_EXTENSION_URL` when set.
- does not call Core as a facade for extension state.

### `meristem extension show <id>`

Permission: `extension:read`.

Shows one extension definition and its `system/default` instance state when present.

### `meristem extension register <manifest-file>`

Permission: `extension:register`.

Registers one `MExtensionManifestV01` document with M-Extension.

Rules:

- manifest must be `controlPlaneOnly: true`.
- only `low` and `medium` risk classes are accepted in Phase 15.
- unknown requested permissions fail registration.
- successful registration writes Audit before persistence.
- this command does not install code, load Wasm, create webhook ingress, bind secrets, or execute callbacks.

### `meristem extension enable <id>`

Permission: `extension:enable`.

Enables the extension instance for `system/default` scope.

Rules:

- Phase 15 does not support node, network, service, tenant, or user scopes.
- successful enable writes Audit before the state transition.
- this command does not execute extension runtime behavior.

### `meristem extension disable <id>`

Permission: `extension:disable`.

Disables the extension instance for `system/default` scope.

Rules:

- successful disable writes Audit before the state transition.
- disable is immediate after M-Policy allow and does not create an approval record.

### `meristem identity actor list`

Permission: `identity:read`.

Lists Identity v0.2 local-mode actors.

### `meristem identity actor show <actor-id>`

Permission: `identity:read`.

Shows one local actor record.

### `meristem identity token issue --actor <actor-id> --ttl <duration> --purpose <text>`

Permission: `identity:token-issue` (security-admin only).

Issues a local actor token.

Rules:

- Only `security-admin` can issue runtime tokens.
- token plaintext is returned once and must never be logged.
- issue writes Audit before returning plaintext.
- issue fails closed when Audit Log is unavailable.
- token metadata includes `jti`, actor, issuedBy, purpose, issuedAt, and expiresAt.

### `meristem identity token inspect <jti>`

Permission: `identity:token-inspect` (admin + security-admin).

Shows token metadata and revocation status without token plaintext.

### `meristem identity token revoke <jti> --reason <text>`

Permission: `identity:token-revoke` (security-admin only).

Revokes one local actor token by `jti`.

Rules:

- revoke writes Audit before changing token status.
- revoke fails closed when Audit Log is unavailable.
- Non-zero exit on missing permission, not-found jti, or Core unavailable.

### `meristem secret list`

Permission: `secret:read-metadata`.

Lists secretRef metadata only.

### `meristem secret show <secret-ref-id>`

Permission: `secret:read-metadata`.

Shows one secretRef metadata record. It must not print secret plaintext.

### `meristem secret create --name <name> --scope system|service|node --value-stdin`

Permission: `secret:create`.

Creates a secretRef and reads plaintext from stdin. The command returns only secretRef metadata.

### `meristem secret rotate <secret-ref-id> --value-stdin --reason <text>`

Permission: `secret:rotate`.

Rotates a secret value and writes Audit before mutation. The command must not print plaintext.

### `meristem secret disable <secret-ref-id> --reason <text>`

Permission: `secret:disable`.

Disables a secretRef and writes Audit before mutation.

### `meristem config list`

Permission: `config:read`.

Lists Config Lifecycle v0.1 records.

### `meristem config show <config-id>`

Permission: `config:read`.

Shows one config record and lifecycle state.

### `meristem config draft --domain <domain> --file <path>`

Permission: `config:draft`.

Creates a config draft from a local file. Plaintext secrets are prohibited; use `secretRef`.

### `meristem config validate <config-id>`

Permission: `config:validate`.

Validates config schema and computes deterministic hash.

### `meristem config publish <config-id> --reason <text>`

Permission: `config:publish`.

Publishes a validated config. High-risk domains require M-Policy and Audit.

### `meristem config rollback <config-id> --to <version> --reason <text>`

Permission: `config:rollback`.

Rolls back to a known version. High-risk domains require M-Policy and Audit.

### `meristem log timeline`

Permission: `timeline:read`.

Shows recent Timeline entries.

### `meristem audit list`

Permission: `audit:read`.

Shows recent Audit Log entries.

### `meristem projection health`

Permission: `projection:read`.

Shows projection index health, lag, pending count, DLQ count, and status.

### `meristem projection backfill --index <name> [--from <cursor>] [--to <cursor>] [--batch-size <n>] [--target-version <version>]`

Permission: `projection:backfill`.

Runs a projection backfill through Core. Core writes Audit Log before execution and fails closed if Audit Log is unavailable.

### `meristem projection dlq list [--index <name>]`

Permission: `projection:read`.

Lists projection DLQ records. This is a read action and does not write Audit Log.

### `meristem projection dlq replay --id <dlq-id>`

Permission: `projection:dlq-manage`.

Replays one projection DLQ record. Core writes Audit Log before execution and writes Timeline Log on success.

### `meristem projection dlq skip --id <dlq-id>`

Permission: `projection:dlq-manage`.

Skips one projection DLQ record. Core writes Audit Log before execution and writes Timeline Log on success.

---

## 3. Token Defaults

MVP seed actors:

| Actor | Role |
|-------|------|
| `viewer` | viewer |
| `operator` | operator |
| `admin` | admin |
| `security-admin` | security-admin |

Generate local MVP tokens with:

```bash
bun run token:mint --actor viewer
bun run token:mint --actor operator
bun run token:mint --actor admin
bun run token:mint --actor security-admin
```

If `MERISTEM_TOKEN` is not set, protected CLI commands fail with a short authentication error and non-zero exit.

---

## 4. Acceptance Scenarios

```bash
MERISTEM_TOKEN=<operator-token> meristem node register --kind leaf --name local-leaf
MERISTEM_TOKEN=<operator-token> meristem node issue-token --node <leaf-node-id>
MERISTEM_TOKEN=<operator-token> meristem network create --name lab-mesh
MERISTEM_TOKEN=<operator-token> meristem network join --network <network-id> --node <stem-node-id>
MERISTEM_TOKEN=<operator-token> meristem network members --network <network-id>
MERISTEM_TOKEN=<operator-token> meristem service list
MERISTEM_TOKEN=<operator-token> meristem service reload --service m-log --reason smoke-test
MERISTEM_TOKEN=<viewer-token> meristem node register --kind leaf --name denied-leaf
MERISTEM_TOKEN=<operator-token> meristem audit list
MERISTEM_TOKEN=<security-admin-token> meristem audit list
```

Expected:

- operator node registration succeeds
- operator node token issuance succeeds
- operator network create/join succeeds
- operator service list/reload succeeds for reloadable services
- viewer node registration fails
- operator audit list fails
- security-admin audit list succeeds

### `meristem policy approvals list`

Permission: `policy:approval-read` (admin + security-admin).

Lists pending approval records.

Rules:

- uses `MERISTEM_POLICY_URL` when set.
- does not write Audit Log for list reads.

### `meristem policy approvals show <approval-id>`

Permission: `policy:approval-read` (admin + security-admin).

Shows one approval record with its votes.

### `meristem policy approvals approve <approval-id> [--reason <text>]`

Permission: `policy:approval-approve` (security-admin only).

Approves a pending approval. Writes Audit Log.

Rules:

- original actor cannot approve their own operation.
- duplicate vote from same actor is rejected.
- non-zero exit on missing permission, self-approval, duplicate vote, or expired approval.

### `meristem policy approvals reject <approval-id> [--reason <text>]`

Permission: `policy:approval-reject` (security-admin only).

Rejects a pending approval. Writes Audit Log.

Rules:

- one reject vote rejects the approval.
- same self-approval and duplicate restrictions as approve.
- non-zero exit on missing permission, self-approval, duplicate vote, or expired approval.
