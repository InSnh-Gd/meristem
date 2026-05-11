# CLI Commands MVP Contract

> M-CLI is the primary MVP operator entrypoint. Commands call Core APIs and must return non-zero exit codes on failure.

---

## 1. Global Rules

- Binary name: `meristem`.
- Default Core URL: `http://localhost:3000`.
- Core URL can be overridden by `MERISTEM_CORE_URL`.
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
- after the first successful join, the agent should reconnect with the returned runtime token instead of reusing the ticket.

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

### `meristem task assign --leaf <node-id> --type noop`

Permission: `task:assign`.

Assigns and completes an MVP noop task against a Leaf node.

Rules:

- only `noop` is supported in MVP.
- target node must be a Leaf.
- `simulated` nodes complete synchronously in Core.
- `agent` nodes require `reachable` state and an active runtime token.
- `agent` noop completion goes through Core -> M-Net internal HTTP -> active join-ingress session `task.execute` -> agent `task.result`.

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

### `meristem log timeline`

Permission: `timeline:read`.

Shows recent Timeline entries.

### `meristem audit list`

Permission: `audit:read`.

Shows recent Audit Log entries.

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
