---
name: meristem-acceptance-scenarios
description: Converts high-risk Meristem work into lightweight BDD-style acceptance scenarios without introducing Gherkin files or step-definition test runners. Use when planning, implementing, reviewing, or documenting cross-service behavior, policy/audit flows, M-UI CommandWell flows, M-Net profile changes, M-Task lifecycle work, contract migrations, or failure-mode-sensitive capabilities.
---

# Meristem Acceptance Scenarios

## 使用时机

在实现、审查或拆分以下 Meristem 工作前使用本 skill：

- 跨 Core / M-* 服务的行为切片。
- M-Policy、Audit Log、M-Log、OpenTelemetry 或 fail-closed 行为。
- M-UI Transitional Workbench、CommandWell、CommandWell Eligibility、Audit Access State。
- M-Net profile、M-Task lifecycle、SecretRef、Config lifecycle、token revoke、投影控制动作。
- REST、Eden、事件、Effect Schema、BFF、SDUI 或迁移契约变化。

本 skill 是 **BDD-lite**：用 Given / When / Then 澄清验收行为，并映射到现有 Bun 测试门禁。默认不引入 `.feature` 文件、Gherkin runner 或 step definitions。

## 不使用时机

不要用于：

- 纯类型修复、格式修复、依赖图检查。
- 小型 pure function 或无外部可观察行为的 helper。
- 纯 perf benchmark。
- 已由 drift guard 精确覆盖的机械 schema/table 对齐。

## 工作流

1. 先加载 `meristem-context-protocol`、`meristem-engineering-guardrails`、`meristem-testing-gates`。
2. 读取相关根文档、服务文档、契约文档、安全/状态/运行/UI 文档。
3. 为当前能力写 3–7 条 acceptance scenarios；每条只描述一个可观察行为。
4. 每条 scenario 必须映射到至少一个现有 Meristem 测试类型：
   - `contract`
   - `failure-mode`
   - `integration`
   - `e2e`
   - `migration`
   - `UI contract`
   - `unit`（仅限纯领域规则或 Effect Schema decode/encode）
5. 使用这些 scenarios 决定要新增或修改的测试；不要让 scenario 取代测试。
6. 实现时按 TDD tracer bullet：一次只让一个 scenario 进入 RED → GREEN。
7. 完成声明必须列出 scenario 到测试文件/命令的映射。

## Scenario 格式

```text
Scenario: <用领域语言命名的行为>

Given <权威前置事实、actor、权限、配置、服务健康状态>
And <相关状态来源：PostgreSQL / M-EventBus / M-Log / Audit / OpenSearch / BFF>
When <actor 通过公开边界触发动作：REST / CLI / BFF / CommandWell / event consumer>
Then <外部可观察结果：status、state、response、UI state、event、log、audit、trace>
And <保守行为：fail closed、no authority drift、redaction、no side effect 等>

Test mapping:
- <test type>: <目标测试文件或待新增测试名>
- Gate: <bun run ...>
```

## Meristem 约束

- 使用 `CONTEXT.md` 里的领域词汇，不要发明同义词。
- Scenario 必须通过公开边界验证行为，不验证私有实现细节。
- 高风险或权限相关 scenario 必须说明 M-Policy、Audit Log、M-Log 的预期证据。
- 跨服务 HTTP / event / BFF scenario 必须说明契约来源和 drift 防线。
- M-UI scenario 必须遵守 M-UI ownership：M-UI 拥有结构与交互，BFF 只适配显示数据，M-* 服务不供应前端组件。
- 禁止把 `.omo/` 路径写入 scenario、测试、文档或 delegation prompt。

## 输出要求

输出 acceptance scenarios 时包含：

1. Scope：本次行为切片属于哪个 M-* / Core / UI / contract 边界。
2. Scenarios：3–7 条 Given / When / Then。
3. Test mapping：每条 scenario 对应的测试类型、文件或命令。
4. Non-goals：明确不覆盖的行为，避免 scope creep。
5. Gate list：本切片完成时必须运行的 Bun 命令。

## 示例

```text
Scenario: viewer cannot submit a task through M-Task

Given a viewer token without task:submit permission
And an existing Leaf node is visible through Core facts
When the actor submits a noop task through the M-Task REST boundary
Then the request is rejected with 403
And no task record is created
And the denial remains attributable to M-Policy-facing permission rules

Test mapping:
- failure-mode: tests/failure-modes/<m-task-permission-denial>.test.ts
- e2e: tests/e2e/core-rest.test.ts or M-Task e2e path
- Gate: bun run test:failure-modes
- Gate: bun run test:e2e
```
