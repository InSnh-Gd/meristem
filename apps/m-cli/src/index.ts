import {
  initTelemetry,
  shutdownTelemetry,
  withActiveSpan
} from '../../../packages/telemetry/src/index.ts'
import { createCliRunner } from './cli.ts'
import { configFromEnv, createCoreClient } from './client.ts'

// CLI 是操作员工具：默认不导出 span（每条命令后的 span JSON 是噪音），
// 只有显式设置 MERISTEM_OTEL_EXPORTER 时才启用对应 exporter。
process.env.MERISTEM_OTEL_EXPORTER ??= 'none'
initTelemetry('meristem-cli')
const runner = createCliRunner(createCoreClient(configFromEnv()))
const result = await withActiveSpan('meristem-cli', 'meristem-cli.run', () =>
  runner.run(Bun.argv.slice(2))
)

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
await shutdownTelemetry()
process.exit(result.exitCode)
