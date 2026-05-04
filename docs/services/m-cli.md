# M-CLI Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-cli` |
| version | `0.1.0` |
| domain | `m-cli` |
| kind | `internal` |

---

## 2. Responsibility

M-CLI is the primary MVP operator entrypoint. It calls Core APIs and presents status, node, network, task, timeline, and audit flows.

Owns:

- command parsing
- Core URL selection
- actor context forwarding
- human-readable and JSON output
- non-zero exit codes on command failure

Must not own:

- authorization decisions
- database writes
- event publishing
- Audit Log writes

---

## 3. Contracts

CLI behavior is defined in `docs/contracts/CLI-COMMANDS.md`.

---

## 4. Done Criteria

- `meristem status` works against local Core.
- node registration/listing commands work.
- logical network create/list/join/member commands work.
- noop task assignment command works.
- timeline and audit list commands work with correct permissions.
- failures print clear errors and exit non-zero.
