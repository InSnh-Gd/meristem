// 兼容入口仅重新导出多主机 Harness 职责模块，保持既有消费者的导入路径稳定。
export type {
  HarnessCheckResult,
  HarnessIssueCode,
  HarnessState,
  HarnessStatus
} from './mnet-multihost-harness-contract.ts'
export {
  loadState,
  resetTopology,
  startTopology,
  stopTopology
} from './mnet-multihost-harness-lifecycle.ts'
export { runPreflightChecks } from './mnet-multihost-harness-preflight.ts'
export { readHarnessStatus } from './mnet-multihost-harness-status.ts'
