/**
 * Core REST API 的共享 Elysia typebox schema。
 * 路由文件统一从这里引入 schema，保证 OpenAPI 输出一致且避免重复定义。
 */

export {
  apiErrorSchema,
  protectedResponse,
  protectedRouteDetail
} from './schemas/shared.ts'
export {
  dependenciesSchema,
  dependencyStateSchema,
  serviceLifecycleSchema,
  serviceRuntimeSchema,
  serviceSummarySchema
} from './schemas/services.ts'
export { nodeSchema, taskSchema } from './schemas/nodes.ts'
export { networkMemberSchema, networkSchema, networkSummarySchema } from './schemas/networks.ts'
export { policyDecisionSchema } from './schemas/policy.ts'
export { auditLogSchema, fullLogSchema, timelineLogSchema } from './schemas/logs.ts'
