# 文件组织与命名规则

## 文件模块化规则

禁止超大单体文件。代码必须按职责、功能域和边界合理拆分，见 `MERISTEM-DEV.md §8.2`。

- 单文件不超过 500 行（非表格、非自动生成文件）。超限必须在 commit message 中说明原因并记录拆分计划。
- 每个文件只承担一个明确功能或职责边界。
- 目录结构反映功能域、服务、路由、组件或工具边界。
- 禁止 god-file：入口文件只做组装和导出，不承载业务逻辑、存储适配、类型定义或错误处理。
- 拆分粒度合理：紧密耦合的内部辅助函数可共存于同一文件，但须在行数上限内。

### 本仓库验证过的重构风格

- 优先做**最小存在性重构**：先问“这段抽象是否真的需要存在”，再动手拆分；能用同文件私有 helper、相邻 `-support.ts`、现有共享模块解决的问题，不要先引入新的 workflow/framework 层。
- 长函数或长文件的第一刀，优先抽**同文件私有 helper**（如分支处理、成功收尾、副作用发布、前置校验），而不是立刻拆成多个新模块。只有当责任边界已经稳定且复用真实存在时，才继续外移到相邻 support/workflow 文件。
- 路由层的重构优先级固定为：`schema -> auth/policy guard -> orchestration call -> response mapping`。如果 handler 内重复出现 auth unwrap、policy authorize、idempotency 读取、事件/审计发布、迁移 apply/resume 等业务编排，必须下沉到相邻 support 文件。
- 对“共享样板”采取**小原语优先**：例如 shared result helper、error envelope helper、单一 readiness probe；禁止因为 2-3 处重复就先造“大一统 startup template”或“generic workflow engine”。
- 现有模块已经提供合适语义位置时，优先回填到现有模块（如 `packages/internal-http`、`packages/common/src/result.ts`），不要平行再造一个“common-utils”层。

### 拆分后的测试责任

- 代码从旧文件拆到新 seam（新文件、新 helper、新 support）后，不能只依赖旧的间接覆盖；至少补一组**直接测试**，证明新 seam 的成功路径、失败映射或 fail-closed 语义。
- 新 seam 的直接测试优先级：
  1. 新抽出的纯函数 / state helper -> unit/contract test
  2. 新抽出的 client factory / adapter -> contract test
  3. 新抽出的 route support / workflow -> integration/contract test
- 如果总覆盖率下降，先区分“本轮新增 seam 缺直接覆盖”与“历史低覆盖债务”，不要把历史覆盖债误判为本轮行为漏测。

## 文件与测试命名规则

文件名和测试文件名必须准确反映功能与职责，禁止随意命名，见 `MERISTEM-DEV.md §8.3`。

- 源文件以单一职责命名（如 `task-state-machine.ts`、`auth-middleware.ts`），禁止 `utils.ts`、`helpers.ts`、`misc.ts` 等模糊名称承载单一功能。
- 测试文件命名：单元测试 `{源文件名}.test.ts`，契约测试 `{契约名}.contract.test.ts`，集成测试 `{场景}.integration.test.ts`，E2E `{流程}.e2e.test.ts`。
- 测试文件与源文件同目录或 `__tests__/` 子目录。
- 目录命名使用 kebab-case，反映功能域或模块边界。
