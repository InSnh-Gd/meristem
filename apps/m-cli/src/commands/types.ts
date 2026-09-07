// CliClient / CliRunResult 已下沉为 client-side contract，canonical 定义在
// packages/contracts/src/types/cli-client.ts；本文件保留 re-export 以维持
// apps/m-cli 内部导入路径和 cli.ts 的对外 re-export 不变。
export type { CliClient, CliRunResult } from '../../../../packages/contracts/src/index.ts'
