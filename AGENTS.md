# AGENTS.md - AI 上下文入口

> 这份文档是 Meristem 仓库的 AI 入口。完整的仓库级上下文协议已经拆分到项目 skill 中，进入本仓库的 AI 代理应先读本文件，再加载对应 skill。

---

## 1. 必用项目 Skill

处理 Meristem 的任何任务时，先使用：

- `.agents/skills/meristem-context-protocol/SKILL.md` - 文档阅读顺序、冲突裁决、产品意图边界、细分文档入口。

修改或审查代码、契约、服务、事件、配置、状态、测试、安全、日志、策略、可观测性、CLI 或 UI 时，同时使用：

- `.agents/skills/meristem-engineering-guardrails/SKILL.md` - Core / 微服务 / 状态边界、Bun-only、Effect 默认规则、注释要求、完成标准、文档同步责任。

触及具体执行边界时，继续加载对应细分项目 skill：

- `.agents/skills/meristem-service-definition/SKILL.md` - 新增、修改或审查 Core、M-* 服务、node service、task service、extension service、BFF 或 service definition。
- `.agents/skills/meristem-contract-versioning/SKILL.md` - 修改 REST、OpenAPI、Eden、事件、Effect Schema、服务定义、配置、策略、日志、Webhook、BFF、SDUI 或 M-Net Profile 契约。
- `.agents/skills/meristem-ui-contract/SKILL.md` - 修改 M-UI、SvelteKit UI、SDUI、BFF display contract、CommandWell、审计/策略/日志可见性或 M-UI 功能演示。
- `.agents/skills/meristem-testing-gates/SKILL.md` - 实现、审查或声明完成任何功能、修复、契约、服务、CLI、BFF、UI、迁移、故障模式或阶段验收。

技术栈相关任务继续使用已有项目 skill：

- `.agents/skills/elysiajs/SKILL.md` - ElysiaJS 路由、插件、schema、OpenAPI、Eden、测试。
- `.agents/skills/effect-ts/SKILL.md` - Effect v4 服务、Layer、Schema、错误、测试、HTTP、CLI、配置。
- `.agents/skills/functional-programming/SKILL.md` - TypeScript 领域逻辑、策略、验证器、事件、状态转换和副作用边界。

---

## 2. 文档入口

完整文档顺序和冲突裁决见 `meristem-context-protocol`。最短入口顺序仍是：

1. `AGENTS.md`
2. `MERISTEM.md`
3. `MERISTEM-DESIGN.md`
4. `MERISTEM-DEV.md`
5. `MERISTEM-ROADMAP.md`
6. `docs/README.md`
7. 相关 ADR、服务定义、事件目录、安全、配置、测试、运行或 UI schema 文档

历史开发草案和旧阶段文档已从当前文档集移除；当前实现规范以根文档、`docs/README.md`、对应契约文档和 `DEFERRED-WORK.md` 为准。

---

## 3. Agent 项目上下文

### Agent submit gate

Before submitting changes, agents must run the focused drift guard that mirrors the latest CI failure mode:

```bash
bun run test:agent-submit
```

This does not replace the boundary-specific gates from `docs/testing/TESTING.md`; it catches schema coverage map drift and M-Task cutover alignment before handoff.

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `InSnh-Gd/meristem`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: read root `CONTEXT.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.
