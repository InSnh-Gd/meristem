# Service Definition Template

> Every Meristem service must have a service definition before implementation. A service definition can start as Markdown and later become `service.definition.ts` or `service.json`.

---

## 1. Required Fields

```ts
type MServiceDefinition = {
  name: string;
  version: string;
  domain:
    | "core"
    | "m-net"
    | "m-eventbus"
    | "m-log"
    | "m-policy"
    | "m-task"
    | "m-ui"
    | "m-cli"
    | "m-extension";
  kind: "core" | "internal" | "node" | "task" | "extension" | "bff";
  contracts: {
    eden?: string;
    rest?: string;
    events?: string[];
  };
  permissions: string[];
  dependencies: string[];
  configSchema?: string;
  health: {
    liveness: boolean;
    readiness: boolean;
  };
  lifecycle: {
    reloadable: boolean;
    rollbackable: boolean;
    degradable: boolean;
  };
  logs: {
    timeline: boolean;
    full: boolean;
    audit: boolean;
  };
  policyRequirements?: string[];
};
```

---

## 2. Markdown Template

```md
# [service-name] Service Definition

## 1. Identity

| Field | Value |
|-------|-------|
| name |  |
| version | 0.1.0 |
| domain |  |
| kind |  |
| owner |  |

## 2. Responsibility

What this service owns:

- 

What this service must not own:

- 

## 3. Contracts

| Contract | Path / Subject | Version | Notes |
|----------|----------------|---------|-------|
| Eden |  |  |  |
| REST |  |  |  |
| Events |  |  |  |

## 4. Permissions

| Permission | Required For | Risk |
|------------|--------------|------|
|  |  | low / medium / high / critical |

## 5. Dependencies

| Dependency | Type | Failure Behavior |
|------------|------|------------------|
|  | service / datastore / event / config |  |

## 6. Configuration

| Key | Type | Required | Hot Reload | Notes |
|-----|------|----------|------------|-------|
|  |  | yes / no | yes / no |  |

## 7. Health

| Check | Meaning | Failure Behavior |
|-------|---------|------------------|
| liveness |  |  |
| readiness |  |  |

## 8. Lifecycle

| Capability | Supported | Notes |
|------------|-----------|-------|
| reloadable | yes / no |  |
| rollbackable | yes / no |  |
| degradable | yes / no |  |

## 9. Logs

| Log | When Written | Required Fields |
|-----|--------------|-----------------|
| Timeline |  |  |
| Full |  |  |
| Audit |  |  |

## 10. Policy Requirements

- 

## 11. Done Criteria

- Service definition is versioned.
- Contracts are declared.
- Permissions are declared.
- Dependencies and failure behavior are declared.
- Health checks are declared.
- Logging behavior is declared.
- Reload, rollback, and degradation behavior are declared.
```

---

## 3. Prohibited Patterns

- A service must not read another service's private state.
- A service must not perform high-risk operations without M-Policy.
- A service must not execute key changes without M-Log and Audit Log when required.
- A service must not publish events that are absent from `docs/events/EVENT-CATALOG.md`.
- A service must not introduce unversioned contracts.
