import { createCliRunner } from './cli.ts'
import { configFromEnv, createCoreClient } from './client.ts'
import { initTelemetry, shutdownTelemetry, withActiveSpan } from '../../../packages/telemetry/src/index.ts'

// CLI 入口只负责拼装 Eden client、运行命令并把标准输出与错误输出维持为脚本友好形状。
initTelemetry('meristem-cli')
const runner = createCliRunner(createCoreClient(configFromEnv()))
const result = await withActiveSpan('meristem-cli', 'meristem-cli.run', () => runner.run(Bun.argv.slice(2)))

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
await shutdownTelemetry()
process.exit(result.exitCode)
