import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'bun:test'

/**
 * 单文件行数硬上限，对应 MERISTEM-DEV §8.2 的文件模块化规则。
 * 超限文件必须拆分，或在 OVERSIZE_ALLOWLIST 中登记原因。
 */
const MAX_FILE_LINES = 500

/** 仓库根目录，从当前测试文件位置向上两级派生，避免任何绝对路径硬编码。 */
const repositoryRoot = path.join(import.meta.dir, '..', '..')

/** 参与扫描的源码与测试边界；只覆盖仓库自有代码，不含生成产物。 */
const SCAN_ROOTS: readonly string[] = ['apps', 'services', 'packages', 'scripts', 'tests']

/** 参与扫描的文件扩展名；Svelte 组件同样受行数预算约束。 */
const SCANNED_EXTENSIONS: readonly string[] = ['.ts', '.svelte']

/**
 * 目录级排除项：依赖目录、构建产物与覆盖率输出不是仓库自有代码，
 * 计入预算会让守卫随构建状态漂移。
 */
const EXCLUDED_DIRECTORY_NAMES: readonly string[] = [
  'node_modules',
  'build',
  'dist',
  '.output',
  '.svelte-kit',
  'coverage'
]

type OversizeAllowlistEntry = {
  /** 相对仓库根的 POSIX 风格路径。 */
  readonly filePath: string
  /** 中文说明：为什么该文件当前允许超限。 */
  readonly reason: string
}

/**
 * 超限豁免清单，语义为“只允许收缩”的 ratchet 基线。
 * 每条记录都是已知技术债，拆分完成后应从清单移除，而不是放宽 MAX_FILE_LINES。
 */
const OVERSIZE_ALLOWLIST: readonly OversizeAllowlistEntry[] = [
  {
    filePath: 'scripts/v02-deploy-proof.ts',
    reason: 'WIP-BLOCKED：属于未提交的 M-Deploy facade WIP，本轮不可重构'
  },
  {
    filePath: 'scripts/mnet-v02-live-proof.ts',
    reason: '仓库级 biome 格式化补齐后越过 500 行阈值，待按取证阶段职责拆分'
  },
  {
    filePath: 'scripts/oci-release.ts',
    reason: '仓库级 biome 格式化补齐后越过 500 行阈值，待按发布步骤职责拆分'
  },
  {
    filePath: 'scripts/mnet-multihost-harness-support.ts',
    reason: 'M-Net 多主机 harness 支撑脚本，待按 preflight / 编排 / 断言职责拆分'
  },
  {
    filePath: 'services/m-deploy/src/testing.ts',
    reason: 'WIP-BLOCKED：属于未提交的 M-Deploy facade WIP，本轮不可重构'
  },
  {
    filePath: 'services/m-deploy/src/postgres-store.ts',
    reason: 'M-Deploy PostgreSQL 存储适配层，待按聚合根拆分查询与写入'
  },
  {
    filePath: 'tests/contracts/m-ui-bff.command-well.test.ts',
    reason: '已排期拆分：CommandWell 契约测试将按动作族拆成多个测试文件'
  },
  {
    filePath: 'tests/contracts/m-ui-bff.routes.test.ts',
    reason: '已排期拆分：BFF 路由契约测试将按路由族拆成多个测试文件'
  },
  {
    filePath: 'tests/contracts/m-net-global-profile-defaults.contract.test.ts',
    reason: '已排期拆分：全局 profile 默认值契约测试将按默认值族拆分'
  },
  {
    filePath: 'tests/contracts/mnet-dataplane-routes.contract.test.ts',
    reason: '已排期拆分：数据面路由契约测试将按路由族拆分'
  },
  {
    filePath: 'tests/contracts/_helpers/schema-coverage.mnet.ts',
    reason: '已排期拆分：M-Net 事件覆盖表将按主题族拆成多个 helper'
  },
  {
    filePath: 'tests/failure-modes/production-security-failure-modes.test.ts',
    reason: '已排期拆分：生产安全故障模式测试将按故障族拆分'
  },
  {
    filePath: 'tests/failure-modes/m-ui-bff-approval-profile.test.ts',
    reason: '已排期拆分：BFF 审批 profile 故障模式测试将按场景拆分'
  },
  {
    filePath: 'tests/failure-modes/m-net-runtime-redaction.test.ts',
    reason: '已排期拆分：M-Net runtime 脱敏故障模式测试将按字段族拆分'
  },
  {
    filePath: 'tests/failure-modes/mnet-closed-loop.failure-mode.test.ts',
    reason: '已排期拆分：M-Net 闭环故障模式测试将按闭环阶段拆分'
  },
  {
    filePath: 'tests/failure-modes/mdeploy-security-repair.failure-mode.test.ts',
    reason: '已排期拆分：M-Deploy 安全修复故障模式测试将按修复路径拆分'
  },
  {
    filePath: 'tests/failure-modes/mnet-dataplane-security-hardening.test.ts',
    reason: '已排期拆分：数据面安全加固故障模式测试将按加固项拆分'
  },
  {
    filePath: 'tests/failure-modes/m-extension-policy.test.ts',
    reason: '已排期拆分：M-Extension 策略故障模式测试将按策略族拆分'
  },
  {
    filePath: 'tests/helpers/backup-restore-fixture.ts',
    reason: '已排期拆分：备份恢复 fixture 将按 backup / restore 职责拆分'
  },
  {
    filePath: 'tests/helpers/mnet-lifecycle-proof-fixture.ts',
    reason: '已排期拆分：M-Net 生命周期 proof fixture 将按生命周期步骤拆分'
  },
  {
    filePath: 'tests/integration/mnet-profile-migration.integration.test.ts',
    reason: '已排期拆分：profile 迁移集成测试将按迁移版本对拆分'
  },
  {
    filePath: 'tests/packages/auth/auth.test.ts',
    reason: '已排期拆分：auth 单元测试将按 verifier / provider / session 拆分'
  },
  {
    filePath: 'tests/services/m-net/closed-loop-workflow.test.ts',
    reason: '已排期拆分：闭环工作流测试将按工作流分支拆分'
  }
]

const allowlistedPaths = new Set(OVERSIZE_ALLOWLIST.map(entry => entry.filePath))

type OversizeFinding = {
  readonly filePath: string
  readonly lineCount: number
}

/**
 * 判断目录项是否需要跳过：显式排除目录，以及任何以 `.` 开头的路径段
 * （缓存、编辑器状态、工具产物），它们不属于仓库自有源码边界。
 */
function isExcludedDirectory(directoryName: string): boolean {
  return directoryName.startsWith('.') || EXCLUDED_DIRECTORY_NAMES.includes(directoryName)
}

function hasScannedExtension(fileName: string): boolean {
  return SCANNED_EXTENSIONS.some(extension => fileName.endsWith(extension))
}

/**
 * 递归收集参与行数预算的文件，返回相对仓库根的 POSIX 路径，
 * 使断言输出与豁免清单可以直接对齐。
 */
function collectBudgetedFiles(absoluteDirectory: string, relativeDirectory: string): string[] {
  const collected: string[] = []

  for (const entryName of readdirSync(absoluteDirectory)) {
    const absoluteEntry = path.join(absoluteDirectory, entryName)
    const relativeEntry = relativeDirectory ? `${relativeDirectory}/${entryName}` : entryName
    const stats = statSync(absoluteEntry)

    if (stats.isDirectory()) {
      if (isExcludedDirectory(entryName)) {
        continue
      }
      collected.push(...collectBudgetedFiles(absoluteEntry, relativeEntry))
      continue
    }

    if (!stats.isFile() || entryName.startsWith('.') || !hasScannedExtension(entryName)) {
      continue
    }

    collected.push(relativeEntry)
  }

  return collected
}

/**
 * 统计文件行数。与 `wc -l` 对齐：以换行符数量为准，
 * 末行无换行时补计一行，避免尾随换行差异导致守卫结果抖动。
 */
async function countLines(relativeFilePath: string): Promise<number> {
  const contents = await Bun.file(path.join(repositoryRoot, relativeFilePath)).text()
  if (contents.length === 0) {
    return 0
  }

  const newlineCount = contents.split('\n').length - 1
  return contents.endsWith('\n') ? newlineCount : newlineCount + 1
}

function buildOversizeMessage(findings: readonly OversizeFinding[]): string {
  return [
    `File size budget exceeded: ${findings.length} file(s) over ${MAX_FILE_LINES} lines.`,
    'Split the file (MERISTEM-DEV §8.2) or register it in OVERSIZE_ALLOWLIST with a reason.',
    ...findings.map(finding => `- ${finding.filePath} (${finding.lineCount} lines)`)
  ].join('\n')
}

const budgetedFiles = SCAN_ROOTS.flatMap(scanRoot =>
  collectBudgetedFiles(path.join(repositoryRoot, scanRoot), scanRoot)
).sort()

describe('file size budget ratchet guard', () => {
  it('scans repository source and test boundaries', () => {
    // 守卫必须真的读到文件系统；空扫描会让整个预算断言退化为恒真。
    expect(budgetedFiles.length).toBeGreaterThan(0)
  })

  it(`keeps every non-allowlisted file within ${MAX_FILE_LINES} lines`, async () => {
    const findings: OversizeFinding[] = []

    for (const relativeFilePath of budgetedFiles) {
      if (allowlistedPaths.has(relativeFilePath)) {
        continue
      }

      const lineCount = await countLines(relativeFilePath)
      if (lineCount > MAX_FILE_LINES) {
        findings.push({ filePath: relativeFilePath, lineCount })
      }
    }

    expect(findings, buildOversizeMessage(findings)).toEqual([])
  })

  it('registers every allowlist entry against a file that still exists', async () => {
    // 清单条目指向已删除文件时，ratchet 会静默失去约束对象：
    // 该路径既不会被扫描命中，也不会有人回头清理记录。
    const missingPaths: string[] = []

    for (const entry of OVERSIZE_ALLOWLIST) {
      const exists = await Bun.file(path.join(repositoryRoot, entry.filePath)).exists()
      if (!exists) {
        missingPaths.push(entry.filePath)
      }
    }

    expect(
      missingPaths,
      [
        `OVERSIZE_ALLOWLIST references ${missingPaths.length} path(s) that no longer exist.`,
        'Remove the stale entries; an allowlist entry without a file constrains nothing.',
        ...missingPaths.map(filePath => `- ${filePath}`)
      ].join('\n')
    ).toEqual([])
  })

  it('keeps the allowlist a shrinking ratchet with no already-compliant entries', async () => {
    // 清单语义是“只允许收缩”：一旦文件拆分到阈值内，记录必须移除。
    // 否则该文件会永久脱离预算约束，重新膨胀时守卫不会报警。
    const compliantEntries: OversizeFinding[] = []

    for (const entry of OVERSIZE_ALLOWLIST) {
      const exists = await Bun.file(path.join(repositoryRoot, entry.filePath)).exists()
      if (!exists) {
        continue
      }

      const lineCount = await countLines(entry.filePath)
      if (lineCount <= MAX_FILE_LINES) {
        compliantEntries.push({ filePath: entry.filePath, lineCount })
      }
    }

    expect(
      compliantEntries,
      [
        `OVERSIZE_ALLOWLIST holds ${compliantEntries.length} entry(ies) already within ${MAX_FILE_LINES} lines.`,
        'Remove them: a compliant file left on the allowlist is permanently exempt from the budget.',
        ...compliantEntries.map(entry => `- ${entry.filePath} (${entry.lineCount} lines)`)
      ].join('\n')
    ).toEqual([])
  })
})
