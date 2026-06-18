# CLI Commands MVP Contract

> M-CLI is the primary operator entrypoint for the current contract baseline.
>
> 本文档是 supporting contract：它定义命令行入口、参数、stdout/stderr 约束与操作规则；外部权限、HTTP error envelope 与 request / response shape 仍以 `REST-API-MVP.md` 为准。

---

## 1. Scope and Authority

- 覆盖 `meristem` CLI 的命令入口、参数、输出与非零退出规则。
- 为操作发现性保留 permission mirror，但若与 `REST-API-MVP.md` 冲突，以 REST 主契约为准。
- 涉及 internal loopback 或 runtime lifecycle 语义时，补充规则来自 `SERVICE-LIFECYCLE-PROTOTYPE.md`。

---

## 2. Global Rules

- Binary name: `meristem`.
- Default Core URL: `http://localhost:3000`.
- Core URL can be overridden by `MERISTEM_CORE_URL`.
- Follow-on service URLs can be overridden by service-specific environment variables such as `MERISTEM_TASK_URL`, `MERISTEM_POLICY_URL`, `MERISTEM_MNET_URL`, and `MERISTEM_EXTENSION_URL` when a command is owned by an external M-* service.
- Actor is selected by a locally signed JWT in `MERISTEM_TOKEN`.
- Output defaults to human-readable text.
- `--json` returns JSON for scripts.
- Failed command exits non-zero and prints a short error with correlationId if available.

---

## 3. Commands

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
- `--mode simulated` keeps the synchronous local-only noop path used for development and tests.
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

### `meristem node-agent install --kind stem|leaf --name <name> [--join-url <url>] [--wg-binary <path>] [--wstunnel-binary <path>] [--acme-directory <url>] [--relay-endpoint <url>]`

Permission: `node:register`.

Installs and configures the node-agent service on the local host. Creates a systemd service unit file, writes the initial configuration, and registers the node with Core if a Join Ticket is provided.

Rules:

- `--kind stem|leaf` is required. `core` is not supported for node-agent.
- `--name` is required and must be unique.
- `--join-url` defaults to `wss://localhost:8443/join/v0/session`.
- `--wg-binary` defaults to `wg` (PATH lookup).
- `--wstunnel-binary` defaults to `wstunnel` (PATH lookup).
- `--acme-directory` defaults to the Let's Encrypt production directory.
- `--relay-endpoint` is optional; when omitted, relay fallback is disabled.
- the command writes the systemd service unit to `/etc/systemd/system/meristem-node-agent.service`.
- the command does not start the service; use `meristem node-agent run` or `systemctl start meristem-node-agent`.
- WireGuard and wstunnel binaries must exist at the specified paths or the command fails with a diagnostic message.
- on success, prints the node ID and service unit path.

### `meristem node-agent run [--foreground]`

Permission: none (local execution only).

Starts the node-agent runtime process. In foreground mode, the agent runs in the current terminal until stopped with SIGINT. Without `--foreground`, the agent starts as a background systemd service.

Rules:

- if `--foreground` is specified, the agent runs in the foreground and logs to stdout.
- without `--foreground`, the command delegates to `systemctl start meristem-node-agent`.
- the agent performs pre-flight checks (WireGuard tooling, wstunnel binary, ACME key) before establishing the M-Net session.
- on join failure, the agent prints a diagnostic message and exits non-zero.
- `MERISTEM_JOIN_TICKET` or `MERISTEM_NODE_ID` + `MERISTEM_NODE_TOKEN` must be set in the environment.

### `meristem node-agent status`

Permission: `core:read`.

Shows the current status of the local node-agent: session state, WireGuard interface state, wstunnel sidecar state, and network-map freshness.

Output fields:

- `nodeId`: registered node ID
- `sessionState`: `disconnected`, `joining`, `healthy`, or `offline`
- `wireguardState`: `configured`, `degraded`, or `unavailable`
- `sidecarState`: `running`, `restarting`, `stopped`, or `unavailable`
- `networkMapVersion`: latest applied map version or `none`
- `networkMapAge`: time since last successful map pull
- `lastHeartbeatAt`: ISO 8601 timestamp of last successful heartbeat
- `agentVersion`: agent version string

### `meristem node list`

Permission: `core:read`.

Lists node ID, kind, name, status, and createdAt.

The current node list output also includes these fields when present:

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
- enable requires M-Policy approval; the command returns a pending approval with `approvalId` and `operationId`.
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

Submits a noop task through M-Task against a Leaf node.

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

See `REST-API-MVP.md` and `SERVICE-LIFECYCLE-PROTOTYPE.md` for the canonical route and lifecycle field semantics.

### `meristem service reload --service <service-id> [--reason <text>]`

Permission: `service:reload`.

Requests a synchronous reload against a reloadable service.

Rules:

- `m-log` is the only reloadable built-in service in the current runtime contract.
- non-reloadable services return `409`.
- unknown services return `404`.
- `--reason` is optional and is forwarded to the internal lifecycle endpoint.
- Route shape remains canonical in `REST-API-MVP.md`; runtime reload semantics remain canonical in `SERVICE-LIFECYCLE-PROTOTYPE.md`.

### `meristem extension list`

Permission: `extension:read`.

Lists M-Extension control plane definitions and system-scoped instance state through M-Extension.

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
- only `low` and `medium` risk classes are accepted in the M-Extension control plane.
- unknown requested permissions fail registration.
- successful registration writes Audit before persistence.
- this command does not install code, load Wasm, create webhook ingress, bind secrets, or execute callbacks.

### `meristem extension enable <id>`

Permission: `extension:enable`.

Enables the extension instance for `system/default` scope.

Rules:

- M-Extension control plane does not support node, network, service, tenant, or user scopes.
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

Lists Identity v0 local-mode actors.

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

### `meristem secret create --name <name> --scope system|service|node --value-stdin [--metadata <json>]`

Permission: `secret:create`.

Creates a secretRef and reads plaintext from stdin. The current implementation also accepts `--value <text>` for tests and local compatibility, but operator usage must prefer `--value-stdin` so plaintext does not enter shell history. The command returns only secretRef metadata.

### `meristem secret rotate <secret-ref-id> --value-stdin --reason <text>`

Permission: `secret:rotate`.

Rotates a secret value and writes Audit before mutation. The current implementation also accepts `--value <text>` for tests and local compatibility, but operator usage must prefer `--value-stdin`. The command must not print plaintext.

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

## 4. Token Defaults

Current seed actors:

| Actor | Role |
|-------|------|
| `viewer` | viewer |
| `operator` | operator |
| `admin` | admin |
| `security-admin` | security-admin |

Generate local operator tokens with:

```bash
bun run token:mint --actor viewer
bun run token:mint --actor operator
bun run token:mint --actor admin
bun run token:mint --actor security-admin
```

If `MERISTEM_TOKEN` is not set, protected CLI commands fail with a short authentication error and non-zero exit.

---

## 5. Operator Smoke Scenarios

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

Expected operator-facing behavior:

- operator node registration succeeds
- operator node token issuance succeeds
- operator network create/join succeeds
- operator service list/reload succeeds for reloadable services
- viewer node registration fails
- operator audit list fails
- security-admin audit list succeeds

Full acceptance coverage and CI gates live in `docs/testing/TESTING.md`.

### `meristem policy approvals list`

Permission: `policy:approval-read` (admin + security-admin).

Lists pending approval records.

Canonical approval route semantics live in `REST-API-MVP.md`.

Rules:

- uses `MERISTEM_POLICY_URL` when set.
- does not write Audit Log for list reads.

### `meristem policy approvals show <approval-id>`

Permission: `policy:approval-read` (admin + security-admin).

Shows one approval record with its votes.

Canonical approval record shape lives in `REST-API-MVP.md`.

### `meristem policy approvals approve <approval-id> [--reason <text>]`

Permission: `policy:approval-approve` (security-admin only).

Approves a pending approval. Writes Audit Log.

Canonical state-transition rules live in `REST-API-MVP.md`.

Rules:

- original actor cannot approve their own operation.
- duplicate vote from same actor is rejected.
- non-zero exit on missing permission, self-approval, duplicate vote, or expired approval.

### `meristem policy approvals reject <approval-id> [--reason <text>]`

Permission: `policy:approval-reject` (security-admin only).

Rejects a pending approval. Writes Audit Log.

Canonical state-transition rules live in `REST-API-MVP.md`.

Rules:

- one reject vote rejects the approval.
- same self-approval and duplicate restrictions as approve.
- non-zero exit on missing permission, self-approval, duplicate vote, or expired approval.
