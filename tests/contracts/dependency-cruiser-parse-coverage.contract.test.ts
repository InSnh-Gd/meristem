import { describe, expect, it } from 'bun:test'

/**
 * dependency-cruiser 解析覆盖率门禁。
 *
 * 背景：本仓同时安装 typescript@6.0.3 与别名 typescript7(npm:typescript@7.0.2)。Bun 把真实包名
 * `typescript` 提升到 .bun/node_modules 并指向 7.0.2，超出 dependency-cruiser 声明的
 * `>=2.0.0 <7.0.0`，使其内置 tsc 转译器 isAvailable() 返回 false。此时 .ts/.tsx/.d.ts 全部不被
 * 解析，退化为 acorn-loose 解析原始 TS：目录仍被巡到，但**依赖边被丢弃**，于是 `no-circular`
 * 等规则静默失效、门禁假绿。配置改用 swc 解析器（@swc/core）规避该提升冲突。
 *
 * 本断言锁定「依赖边数」下限而非模块数：退化解析下模块数变化不大，依赖边数会大幅塌缩，
 * 因此 totalDependenciesCruised 才是判别器。若未来有人移除 parser:'swc' 或解析器失效，
 * 此测试会失败，防止门禁再次静默假绿。
 */

const repoRoot = `${import.meta.dir}/../..`

type CruiseSummary = {
  totalCruised: number
  totalDependenciesCruised: number
  error: number
}

/** 实测基线（见计划 M1 普查）：swc 解析下 768 模块 / 2702 依赖边。下限留出余量。 */
const MIN_MODULES_CRUISED = 600
const MIN_DEPENDENCIES_CRUISED = 2000

async function cruiseSummary(): Promise<CruiseSummary> {
  const process = Bun.spawn(
    [
      'bunx',
      'depcruise',
      '--config',
      '.dependency-cruiser.cjs',
      'apps',
      'services',
      'packages',
      '--output-type',
      'json'
    ],
    { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' }
  )
  const [stdout, , exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  // warn 级违规不阻断（循环规则当前为 warn），但不接受解析失败导致的非零退出。
  expect(exitCode).toBe(0)
  const result = JSON.parse(stdout) as { summary: CruiseSummary }
  return result.summary
}

describe('dependency-cruiser parse coverage contract', () => {
  it('parses TypeScript sources and resolves their dependency edges', async () => {
    const summary = await cruiseSummary()
    expect(summary.totalCruised).toBeGreaterThanOrEqual(MIN_MODULES_CRUISED)
    expect(summary.totalDependenciesCruised).toBeGreaterThanOrEqual(MIN_DEPENDENCIES_CRUISED)
  }, 60_000)
})
