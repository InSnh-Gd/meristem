# Config Lifecycle

> Hot reload is only safe when configuration changes are versioned, validated, published, acknowledged, and rollbackable.

This document applies to authoritative configuration changes. The current service reload prototype is a narrower runtime control path and does not replace this state machine; see `docs/contracts/SERVICE-LIFECYCLE-PROTOTYPE.md`.

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
