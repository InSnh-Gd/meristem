# 类型安全与路由架构边界规则

## 类型断言边界

- 对于仓库内部使用 `ok/error` 语义的同步/异步端口返回值，默认复用 `packages/common/src/result.ts` 的 `Result<T, E>`、`ok()`、`err()`，不要在服务内部重复声明相同的 `{ ok: true; value } | { ok: false; error }` 联合形状。
- `packages/contracts/src/schemas/**` 中的 Effect Schema companion type 默认使用 `XFromSchema` 命名；如果需要提供无后缀的消费层别名，应放在 `packages/contracts/src/types/**` 或调用侧 import alias，不要在 schema 文件里混用 bare-name companion type。
- 历史兼容命名（如 `SecretRefV01` 这类 schema 常量）可以保留在 schema value 层；但它们的 companion type 仍应统一为 `SecretRefV01FromSchema`，无后缀类型名只允许出现在 `types/**` re-export 或调用侧 alias。
- 生产代码禁止 `as unknown as` 双重断言，除非是文档化的 ORM/runtime 限制（如 Drizzle 动态列访问、`globalThis` 非标准属性读取），且必须在行内注释说明限制原因。
- 跨服务 HTTP 边界不得用 `result.data as { ... }` 直接断言；必须用 Effect Schema `Schema.decodeUnknownSync` 或 TypeBox 校验后再使用已验证数据。
- `as any`、`@ts-ignore`、`@ts-expect-error` 在生产代码中全面禁止；测试代码中 `@ts-expect-error` 仅用于验证编译器错误路径，不得用于绕过测试基础设施类型。
- `skipLibCheck: true` 是当前已知放松点，接受但不可扩展到项目自身 `.d.ts`。
- 测试 helper 构造 mock 时应优先用结构化部分对象 + 覆盖特定方法，而非 `as unknown as TargetType` 整体强转；当目标类型过于刚性导致无法合理构造时，应先放宽目标类型定义而非用断言绕过。

## Support helper 错误传播

- 从路由层提取的 support helper 不得依赖 `externalApiError(...) as never` 或类似 never-return helper 在 helper 内部短路。
- Support helper 必须返回显式 tagged failure union（如 `{ kind: 'failure'; status: ...; error: ... }`），由路由顶层统一 `return` 做最终状态映射。
- 路由层负责唯一的 `return` / `set.status` 调用；support 层不得直接操作 Elysia response 对象。
- 这条规则同样适用于 Core 路由的 `CoreError` throw 模式：support 层可以 throw `CoreError`，但不得在 helper 内部调用 Elysia `status()` 回调。

## TypeBox / Elysia 输入边界

- TypeBox `t.*` 是 Elysia 路由的 primary input validator；禁止在路由 handler 内手写 body parser 替代 schema 校验。
- preview body 和 execute body 必须使用独立的 TypeBox union，不得复用同一个 union 消化不同语义的请求体。
- 共享 response schema helper 应集中定义 401/403/404/409/500/503 响应形状，避免每个路由重复堆定义。
- Elysia 路由错误 envelope 默认复用 `packages/contracts/src/elysia.ts` 的 `apiErrorRouteSchema`，不要在服务内重复手写 `{ error: { code, message, correlationId? } }`。
- 路由 body/params/response 的类型推导应直接来自 TypeBox schema，不靠中间断言补回。

## 路由层职责

- 路由 handler 应保持薄：schema 定义 + auth/policy 守卫 + service/port 调用 + response 返回。
- 业务逻辑（状态机、事件序列、审计链、多步副作用编排）必须下沉到共址 support / workflow 文件。
- 共享路由脚手架（auth、policy authorize、result unwrap、audit、not-found、timeline）应抽到 support 文件，不在每个 handler 内重复拼装。
- 新增路由文件应在同目录或共址位置提供对应 `-support.ts` 文件，承载非编排逻辑。
- 路由文件超过 300 行时，必须评估是否需要拆分 support / workflow；超过 500 行按文件模块化规则禁止。

## 类型门禁覆盖

- `bun run typecheck`（主仓库）、`bun run typecheck:e2e`（e2e）、`bun run typecheck:m-ui`（M-UI SvelteKit）三道门禁必须全部通过。
- `scripts/git-hooks/pre-push` 必须包含 typecheck 门禁，不能只跑格式和 drift guard。
- 新增 app 或独立子项目时，必须同时接入仓库级 typecheck 覆盖。
