import {
  initTelemetry,
  shutdownTelemetry,
  withActiveSpan
} from '../../../packages/telemetry/src/index.ts'
import { createCliRunner } from './cli.ts'
import type { CliRunResult } from './cli.ts'
import { configFromEnv, createCoreClient } from './client.ts'

class CliCommandFailure extends Error {
  constructor(readonly result: CliRunResult) {
    super(result.stderr.trim() || `CLI command failed with exit code ${result.exitCode}`)
    this.name = 'CliCommandFailure'
  }
}

// CLI 入口只负责拼装 Eden client、运行命令并把标准输出与错误输出维持为脚本友好形状。
initTelemetry('meristem-cli')
const runner = createCliRunner(createCoreClient(configFromEnv()))
let result: CliRunResult
try {
  result = await withActiveSpan('meristem-cli', 'meristem-cli.run', async () => {
    const commandResult = await runner.run(Bun.argv.slice(2))
    if (commandResult.exitCode !== 0) throw new CliCommandFailure(commandResult)
    return commandResult
  })
} catch (error) {
  if (!(error instanceof CliCommandFailure)) throw error
  result = error.result
}

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
await shutdownTelemetry()
process.exit(result.exitCode)
