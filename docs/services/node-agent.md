# Node Agent Service Definition

> Node agent is not fully implemented in MVP. This document reserves the boundary so Phase 3 does not accidentally overbuild networking or remote execution.

## 1. Identity

| Field | Value |
|-------|-------|
| name | `node-agent` |
| version | `0.1.0` |
| domain | `m-net` |
| kind | `node` |

---

## 2. MVP Boundary

MVP does not require a real node agent process. Core simulates the smallest node state and noop task flow.

Allowed in MVP:

- register Stem / Leaf node records
- mark Leaf node as restricted by metadata
- assign and complete noop task synchronously
- publish node and task events

Not allowed in MVP:

- remote task execution
- persistent agent process
- DERP / UDP / TCP implementation
- real node-to-node connectivity
- Leaf permission expansion beyond metadata

---

## 3. Future Responsibility

Later phases may make node-agent responsible for:

- node heartbeat
- readiness/liveness reporting
- task execution
- network reachability reporting
- local policy scope enforcement
- log forwarding

Any future implementation must preserve the Leaf default-minimum rule.
