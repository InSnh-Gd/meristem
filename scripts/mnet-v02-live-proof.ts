// 兼容入口重新导出 live proof 工作流，并保留既有 CLI 执行路径。
// 三主机 topology: ['control', 'node-a', 'node-b'] 的 profileVersion: 'm-net@0.3.0' 通过 runV02DeployProof 生成 packetReachability；缺失条件报告 prerequisite-missing。
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rootDir } from './local-stack-runtime.ts'
import { runMNetV02LiveProof } from './mnet-v02-live-proof-workflow.ts'

export { runMNetV02LiveProof } from './mnet-v02-live-proof-workflow.ts'

if (import.meta.main) {
  const report = await runMNetV02LiveProof({ argv: process.argv })
  writeFileSync(
    join(rootDir, 'tests', 'evidence', 'mnet-v02-live-proof.json'),
    `${JSON.stringify(report, null, 2)}\n`
  )
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exit(0)
}
