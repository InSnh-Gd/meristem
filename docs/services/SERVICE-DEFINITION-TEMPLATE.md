# Service Definition Template

> Every Meristem service must have a service definition before implementation. A service definition can start as Markdown and later become `service.definition.ts` or `service.json`.
>
> 本文档只定义服务文档的字段与结构。跨服务治理规则仍以 `MERISTEM-DEV.md`、`docs/contracts/CONTRACT-VERSIONING.md`、`docs/events/EVENT-CATALOG.md`、`docs/security/SECURITY-MODEL.md` 为准。

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

## 3. Notes for Authors

- Keep the service definition focused on ownership, contracts, dependencies, lifecycle, logging, and policy requirements for that service.
- Do not restate cross-repo governance rules in each service definition; reference the governing document instead.
- If a service exposes REST, Eden, events, config, or state boundaries, keep the path / subject / schema names aligned with the corresponding contract documents.
