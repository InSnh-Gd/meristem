# Config Lifecycle

> Hot reload is only safe when configuration changes are versioned, validated, published, acknowledged, and rollbackable.

This document applies to authoritative configuration changes. The current service reload prototype is a narrower runtime control path and does not replace this state machine; see `docs/contracts/SERVICE-LIFECYCLE-PROTOTYPE.md`.

Config Lifecycle v0.1 implements the first subset of this lifecycle. It is intentionally narrower than a broad configuration platform or UI authoring system.

What Config Lifecycle v0.1 already delivers:

- generic config records for multiple domains (`core`, `m-net`, `m-policy`, `m-log`, `m-extension`, `m-ui`).
- executable subset: draft → validated → published → applied → rolled_back.
- hash-versioning, secretRef compliance, and M-Policy support.

What remains deferred:

- node-level apply acknowledgements (distributed ack from multiple nodes).
- absorbing M-Net profile lifecycle into the generic config lifecycle.

---

## 1. State Machine

```text
draft
-> validate
-> commit
-> version
-> hash/sign
-> publish
-> apply
-> ack
-> rollback
```

No implementation may skip validation, versioning, publish, apply, and ack.

Config Lifecycle v0.1 supports this executable subset:

```text
draft
-> validated
-> published
-> applied

validated -> failed
published -> failed
applied -> rolled_back
failed -> rolled_back
```

---

## 2. Config Record

```ts
type MConfigRecord = {
  configVersion: string;
  configHash: string;
  schemaVersion: string;
  targetScope: string[];
  publishedBy?: string;
  publishedAt?: string;
  appliedNodes: string[];
  failedNodes: string[];
  rollbackVersion?: string;
};
```

Config Lifecycle v0.1 config payloads must not contain plaintext secret values. Use `secretRef` for secret-bearing configuration.

---

## 3. Applicable Configs

- M-Net policy
- M-Net CN profile
- M-Policy rule
- microservice config
- M-UI SDUI schema
- M-Extension config
- Webhook config
- OpenTelemetry config

---

## 4. Policy and Audit

| Change | M-Policy | Audit Log |
|--------|----------|-----------|
| low-risk service config | optional in v0 | Timeline + Full |
| high-risk service config | required | required |
| M-Net policy | required | required |
| M-Net CN profile | required | required |
| M-Policy rule | required | required |
| secret-related config | required | required |
| SDUI schema | required if it exposes privileged action | Full, Audit if high-risk |

Config Lifecycle v0.1 ownership rules:

- Core owns generic config records, versions, transitions, and apply acknowledgements.
- domain services own domain-specific apply behavior.
- M-Policy authorizes protected publish / rollback.
- M-Log records Timeline, Full, and Audit facts.

---

## 5. Failure Behavior

| Failure | Behavior |
|---------|----------|
| validation fails | do not commit; write Full Log |
| publish fails | config remains previous version |
| node apply fails | mark node failed; do not assume convergence |
| ack missing | mark pending or failed after timeout |
| rollback fails | enter degraded mode and require manual review |

---

## 6. Done Criteria

- Schema validation is test-covered.
- Config hash is deterministic.
- Publish writes an event.
- Target nodes ack or fail explicitly.
- Rollback target version is known.
- High-risk config goes through M-Policy and Audit Log.
