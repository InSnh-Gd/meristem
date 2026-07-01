import type { CliClient } from '../../../../packages/contracts/src/index.ts'

export type { CliClient }

// CLI 结果统一收敛成 stdout/stderr/exitCode，方便测试和 shell 脚本直接断言。
export type CliRunResult = {
  exitCode: 0 | 1
  stdout: string
  stderr: string
}
