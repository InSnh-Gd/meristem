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
- `.agents/skills/meristem-ui-contract/SKILL.md` - 修改 M-UI、SvelteKit UI、SDUI、BFF workbench contract、CommandWell、审计/策略/日志可见性或过渡型工作台行为。
- `.agents/skills/meristem-testing-gates/SKILL.md` - 实现、审查或声明完成任何功能、修复、契约、服务、CLI、BFF、UI、迁移、故障模式或阶段验收。
- `.agents/skills/meristem-acceptance-scenarios/SKILL.md` - 为跨服务、高风险、权限/审计、M-UI CommandWell、M-Net profile、M-Task lifecycle 或契约迁移工作编写轻量 BDD-lite acceptance scenarios，并映射到现有测试门禁。

代码库探索与理解始终使用：

- `.agents/skills/meristem-codegraph/SKILL.md` - 代替重复 grep/read 的 CodeGraph 使用规则：何时优先用 CodeGraph、可用工具映射、优先级顺序、以及不使用 CodeGraph 的场景。

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

### Code intelligence tools

本仓库使用以下本地代码图与架构分析工具辅助开发和 Agent 探索：

- **CodeGraph** (`colbymchenry/codegraph`)：预索引的本地代码知识图，为 OpenCode 等 Agent 提供符号级调用链、影响半径和代码问答。索引位于 `.codegraph/`（已加入 `.gitignore`，不提交）。初始化一次后文件变更会自动同步。
  - 常用命令：
    - `codegraph explore "how does X work"`
    - `codegraph impact <symbol>`
    - `codegraph callers <symbol>`
    - `bun run codegraph:status`
- **dependency-cruiser**：依赖图可视化与架构规则检查。配置位于 `.dependency-cruiser.cjs`。
  - 常用命令：
    - `bun run depcruise` — 检查依赖规则
    - `bun run depcruise:mermaid` — 生成 Mermaid 依赖图
    - `bun run depcruise:html` — 生成 HTML 交互式依赖图

这些工具是开发辅助，不替代 `bun run lint` 中的既有边界导入检查。Agent 在回答结构性问题时应**优先使用 CodeGraph**，而不是重复发起大量 grep/read 探索。详细的 CodeGraph 优先级规则和触发场景见 `.agents/skills/meristem-codegraph/SKILL.md`。

### Issue tracker

Issues and PRDs are tracked in GitHub Issues for `InSnh-Gd/meristem`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### `.omo/` isolation constraint

The `.omo/` directory is internal orchestration state (plans, drafts, evidence, notepad). It MUST NOT leak into source code, tests, or production docs:

- **Tests**: evidence output paths must use `tests/evidence/` or temp directories, never `.omo/evidence/`.
- **Docs** (RUNBOOK, TESTING, etc.): must not reference `.omo/` paths in commands, examples, or assertions.
- **Delegation prompts**: extract task specs from `.omo/plans/` and inline them directly — never pass `.omo/` file paths to subagents.
- **Route assertions**: contract tests must not assert that docs contain `.omo/` paths.

Violations will be caught during review and must be fixed before submission.

### Evidence naming and path standard

Evidence files, test output paths, and documentation references MUST follow standardized naming. No hardcoded ad-hoc paths.

- **Evidence directory**: `tests/evidence/` — the only location for test-produced evidence artifacts.
- **File naming**: `<feature>-<scenario>.<ext>` — describe the feature and scenario, never the task number. Example: `mnet-harness-preflight.txt`, not `task-15-harness-preflight.txt`.
- **Test code**: derive evidence paths from `import.meta.dir` relative joins or `mkdtemp`, never hardcode absolute paths or `.omo/` paths.
- **Documentation**: reference commands only, not evidence output paths. Example: write `bun run mnet:harness:preflight`, not `bun run mnet:harness:preflight | tee .omo/evidence/task-15-...`.
- **Contract test assertions**: must not assert that docs contain specific evidence file paths.
- **Forbidden**: `task-N-*` prefixes, `.omo/` paths, hardcoded absolute paths, plan-internal identifiers in source code.

### Domain docs

This is a single-context repo: read root `CONTEXT.md` and relevant ADRs under `docs/adr/`. See `docs/agents/domain.md`.
