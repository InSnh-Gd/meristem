# Phase 3 - Core / Stem / Leaf Node MVP

> Goal: implement the smallest node model and noop Leaf task flow.

---

## 1. Scope

Phase 3 includes:

- node table and node schema.
- register Stem node.
- register Leaf node.
- list nodes.
- node status changes.
- noop task assignment to Leaf node.
- task completion event.
- CLI node and task commands.
- Timeline placeholders until Phase 4 finalizes logs.

Phase 3 excludes:

- real network connectivity.
- DERP / UDP / TCP path selection.
- real node agent process.
- remote task execution.
- Leaf permission expansion beyond stored metadata.

---

## 2. Target Files

Expected implementation areas:

```text
apps/core/
apps/m-cli/
packages/contracts/
packages/events/
packages/testing/
```

---

## 3. Required API

- `POST /api/v0/nodes`
- `GET /api/v0/nodes`
- `GET /api/v0/nodes/:id`
- `POST /api/v0/tasks`
- `GET /api/v0/tasks/:id`

---

## 4. Required CLI

```bash
meristem node register --kind stem --name <name>
meristem node register --kind leaf --name <name>
meristem node list
meristem task assign --leaf <node-id> --type noop
```

---

## 5. Required Events

- `node.registration.requested.v0`
- `node.registration.accepted.v0`
- `node.status.changed.v0`
- `task.assignment.requested.v0`
- `task.assignment.completed.v0`

---

## 6. Completion Criteria

- One Stem node can be registered.
- One Leaf node can be registered.
- Leaf node defaults to low permission, restricted API, restricted interconnect metadata.
- Core can assign noop task to Leaf node.
- Noop task completes deterministically.
- Node and task actions publish documented events.
- Node and task records persist in PostgreSQL.
- CLI returns useful IDs for follow-up commands.

---

## 7. Verification Checklist

```bash
meristem node register --kind stem --name local-stem
meristem node register --kind leaf --name local-leaf
meristem node list
meristem task assign --leaf <leaf-node-id> --type noop
```

Manual checks:

- verify node records in PostgreSQL
- verify task record in PostgreSQL
- observe node and task NATS events
