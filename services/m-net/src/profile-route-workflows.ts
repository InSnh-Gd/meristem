/**
 * profile-route-workflows 已按职责拆分为三个文件：
 * - profile-workflow-types.ts：共享类型、常量、工具函数
 * - profile-enable-disable-workflows.ts：enable/disable 常规流程
 * - profile-break-glass-workflow.ts：break-glass 安全恢复路径
 *
 * 本文件仅保留 re-export，保持 profile-routes.ts 的 import 路径不变。
 */
export {
  requestNetworkProfileChange,
  requireProfileReadDeps,
  requireProfileWriteDeps,
  isProfileWorkflowFailure
} from './profile-enable-disable-workflows.ts'
export { executeBreakGlassDisable, requireBreakGlassDeps } from './profile-break-glass-workflow.ts'
export type {
  ProfileWorkflowFailure,
  RouteSet,
  ProfileReadDeps,
  ProfileWriteDeps,
  BreakGlassDeps,
  ProfileWriteBody,
  BreakGlassBody
} from './profile-workflow-types.ts'
