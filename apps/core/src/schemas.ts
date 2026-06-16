/**
 * Core REST API 的共享 Elysia typebox schema。
 * 路由文件统一从这里引入 schema，保证 OpenAPI 输出一致且避免重复定义。
 */

export {
  approvalDetailResponseSchema,
  approvalListResponseSchema,
  mNetRegionalProfileSchema,
  networkProfileListResponseSchema
} from './schemas/approval-profile-facade.ts'
export { auditLogSchema, fullLogSchema, timelineLogSchema } from './schemas/logs.ts'
export { networkMemberSchema, networkSchema, networkSummarySchema } from './schemas/networks.ts'
export { nodeSchema, taskSchema } from './schemas/nodes.ts'
export { policyDecisionSchema } from './schemas/policy.ts'
export {
  dependenciesSchema,
  dependencyStateSchema,
  serviceLifecycleSchema,
  serviceRuntimeSchema,
  serviceSummarySchema
} from './schemas/services.ts'
export {
  apiErrorSchema,
  protectedResponse,
  protectedRouteDetail
} from './schemas/shared.ts'
