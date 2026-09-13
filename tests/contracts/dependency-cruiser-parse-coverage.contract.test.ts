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
  // 注意：json reporter 的 exitCode 恒为 0（report/json.mjs 硬编码），不能据此判断门禁。
  // 因此改用 summary.error 断言当前无 error 级违规（真实门禁用默认 reporter，exitCode = error 数）。
  expect(exitCode).toBe(0)
  const result = JSON.parse(stdout) as { summary: CruiseSummary }
  expect(result.summary.error).toBe(0)
  return result.summary
}

describe('dependency-cruiser parse coverage contract', () => {
  it('parses TypeScript sources and resolves their dependency edges', async () => {
    const summary = await cruiseSummary()
    expect(summary.totalCruised).toBeGreaterThanOrEqual(MIN_MODULES_CRUISED)
    expect(summary.totalDependenciesCruised).toBeGreaterThanOrEqual(MIN_DEPENDENCIES_CRUISED)
  }, 60_000)

  it('actually reports a seeded cycle (positive control for the cycle rule)', async () => {
    // 若解析器失效，no-circular 也会静默失效；本用例种一个真实循环、配最小 error 级规则，
    // 用**默认 reporter** 断言退出码非零（json reporter 恒为 0，无法证明门禁阻断）。
    const fixtureRoot = `/tmp/meristem-depcruise-cycle-${crypto.randomUUID()}`
    const srcDir = `${fixtureRoot}/apps/core/src`
    await Bun.write(
      `${srcDir}/cycle-a.ts`,
      "import { b } from './cycle-b.ts'\nexport const a = b\n"
    )
    await Bun.write(
      `${srcDir}/cycle-b.ts`,
      "import { a } from './cycle-a.ts'\nexport const b = a\n"
    )
    await Bun.write(
      `${fixtureRoot}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: { moduleResolution: 'Bundler', allowImportingTsExtensions: true }
      })
    )
    await Bun.write(
      `${fixtureRoot}/depcruise.config.cjs`,
      `module.exports = {
        forbidden: [{ name: 'no-circular-core', severity: 'error', from: { path: '^apps/core/src/' }, to: { circular: true } }],
        options: { parser: 'swc', tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: ['node_modules'] } }
      }
      `
    )

    try {
      // fixture 在 /tmp，需借仓库的 depcruise 与 @swc/core：链接 node_modules 并直接调用二进制，
      // 避免 bunx 在无 node_modules 的临时目录里解析失败。
      await Bun.spawn(['ln', '-s', `${repoRoot}/node_modules`, `${fixtureRoot}/node_modules`])
        .exited
      const depcruiseBin = `${repoRoot}/node_modules/.bin/depcruise`
      const process = Bun.spawn(
        [depcruiseBin, '--config', `${fixtureRoot}/depcruise.config.cjs`, 'apps'],
        { cwd: fixtureRoot, stdout: 'pipe', stderr: 'pipe' }
      )
      const [stdout, , exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited
      ])
      expect(stdout).toContain('no-circular-core')
      // error 级违规必须导致非零退出码（gate 才能真正阻断）。
      expect(exitCode).not.toBe(0)
    } finally {
      await Bun.spawn(['rm', '-rf', fixtureRoot]).exited
    }
  }, 60_000)

  it('blocks cross-service m-net internal reach-in, including prefix-named evasion (positive control)', async () => {
    // 用**真实** .dependency-cruiser.cjs 跑 fixture：`no-cross-service-mnet-internals` 的正则
    // 若被放宽为前缀匹配，`app-internal.ts` 这类文件与 apps/ 目录会静默逃逸。本用例锁定两类
    // 逃逸均被拦截、且真正的公开入口不被误伤。
    const fixtureRoot = `/tmp/meristem-mnet-boundary-${crypto.randomUUID()}`
    const mk = async (rel: string, content: string) => {
      const path = `${fixtureRoot}/${rel}`
      await Bun.spawn(['mkdir', '-p', path.split('/').slice(0, -1).join('/')]).exited
      await Bun.write(path, content)
    }
    try {
      // 真实 config 引用 tsconfig.base.json（相对仓库根），fixture 必须提供同名的 base
      // 并带上 alias 映射，否则 depcruise 报 ENOENT 且别名无法解析。
      await Bun.write(
        `${fixtureRoot}/tsconfig.base.json`,
        JSON.stringify({
          compilerOptions: {
            moduleResolution: 'Bundler',
            allowImportingTsExtensions: true,
            paths: { '@m-net/*': ['./services/m-net/src/*'] }
          }
        })
      )
      // m-net 内部模块（含与前缀同名但不属公开入口的文件：app-internal.ts / server.ts）
      await mk('services/m-net/src/app.ts', 'export const pub = 1\n')
      await mk('services/m-net/src/app-internal.ts', 'export const internal = 1\n')
      await mk('services/m-net/src/server.ts', 'export const srv = 1\n')
      await mk('services/m-net/src/serve-local.ts', 'export const serveLocal = 1\n')
      await mk('services/m-net/src/data-plane/secret-const.ts', 'export const c = 1\n')
      // 违规：其它服务深层导入内部（含前缀逃逸）
      await mk(
        'services/m-task/src/reach.ts',
        "import { internal } from '@m-net/app-internal.ts'\nimport { srv } from '@m-net/server.ts'\nimport { c } from '@m-net/data-plane/secret-const.ts'\nexport const v = [internal, srv, c]\n"
      )
      // 合法：导入 serve-local（m-net 自身 bootstrap 入口，属公开入口）
      await mk(
        'services/m-other/src/ok-serve.ts',
        "import { serveLocal } from '@m-net/serve-local.ts'\nexport const v = serveLocal\n"
      )
      // 违规：apps 深层导入内部（规则此前不覆盖 apps/）
      await mk(
        'apps/core/src/reach.ts',
        "import { c } from '@m-net/data-plane/secret-const.ts'\nexport const v = c\n"
      )
      // 合法：导入 m-net 公开入口（用 public-types 避开另一条 no-apps-importing-service-app-internals 规则）
      await mk('services/m-net/src/public-types.ts', 'export const pubType = 1\n')
      await mk(
        'services/m-task/src/ok.ts',
        "import { pubType } from '@m-net/public-types.ts'\nexport const v = pubType\n"
      )
      // 合法：node-agent 豁免（ADR-N04 共享数据面常量）
      await mk(
        'services/node-agent/src/ok.ts',
        "import { c } from '@m-net/data-plane/secret-const.ts'\nexport const v = c\n"
      )

      await Bun.spawn(['ln', '-s', `${repoRoot}/node_modules`, `${fixtureRoot}/node_modules`])
        .exited
      const process = Bun.spawn(
        [
          `${repoRoot}/node_modules/.bin/depcruise`,
          '--config',
          `${repoRoot}/.dependency-cruiser.cjs`,
          'services',
          'apps'
        ],
        { cwd: fixtureRoot, stdout: 'pipe', stderr: 'pipe' }
      )
      const [stdout, , exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited
      ])
      const hits = stdout
        .split('\n')
        .filter(line => line.includes('no-cross-service-mnet-internals'))
      // 违规的 4 条边（task/reach.ts 的 3 条 import + core/reach.ts 的 1 条）必须逐条被检出：
      // 用 toBe 而非 toBeGreaterThanOrEqual——部分放宽（如 app\.ts$ 退化为前缀匹配、仅
      // app-internal.ts 逃逸）会让 hits 4→3，>=3 断言测不到这种单边回退。
      expect(hits.length).toBe(4)
      expect(stdout).toContain('services/m-task/src/reach.ts')
      expect(stdout).toContain('apps/core/src/reach.ts')
      // 公开入口与 node-agent 豁免不得被误伤。
      expect(stdout).not.toContain('services/m-task/src/ok.ts')
      expect(stdout).not.toContain('services/node-agent/src/ok.ts')
      expect(exitCode).not.toBe(0)
    } finally {
      await Bun.spawn(['rm', '-rf', fixtureRoot]).exited
    }
  }, 60_000)

  /**
   * 在 /tmp fixture 中种入真实两文件循环，用**真实** .dependency-cruiser.cjs 巡检。
   * 钉住属性：no-circular-core / no-circular-mnet 若被删除，stdout 不含规则名；
   * 若被降级为 warn，默认 reporter 的退出码不再计入 → 两条断言都会失败。
   * 全局 warn 版 no-circular 已用 from.pathNot 排除这两棵树，规则被删后连 warn 都没有，
   * 因此必须各用一条正控钉住。
   */
  async function cruiseSeededCycle(
    cycleDir: 'apps/core/src' | 'services/m-net/src',
    target: 'apps' | 'services'
  ): Promise<{ stdout: string; exitCode: number }> {
    const fixtureRoot = `/tmp/meristem-depcruise-pin-${crypto.randomUUID()}`
    const mk = async (rel: string, content: string) => {
      const path = `${fixtureRoot}/${rel}`
      await Bun.spawn(['mkdir', '-p', path.split('/').slice(0, -1).join('/')]).exited
      await Bun.write(path, content)
    }
    try {
      // 真实 config 引用 tsconfig.base.json（相对 cwd 解析），fixture 必须提供同名文件。
      await mk(
        'tsconfig.base.json',
        JSON.stringify({
          compilerOptions: { moduleResolution: 'Bundler', allowImportingTsExtensions: true }
        })
      )
      await mk(`${cycleDir}/cycle-a.ts`, "import { b } from './cycle-b.ts'\nexport const a = b\n")
      await mk(`${cycleDir}/cycle-b.ts`, "import { a } from './cycle-a.ts'\nexport const b = a\n")
      await Bun.spawn(['ln', '-s', `${repoRoot}/node_modules`, `${fixtureRoot}/node_modules`])
        .exited
      const process = Bun.spawn(
        [
          `${repoRoot}/node_modules/.bin/depcruise`,
          '--config',
          `${repoRoot}/.dependency-cruiser.cjs`,
          target
        ],
        { cwd: fixtureRoot, stdout: 'pipe', stderr: 'pipe' }
      )
      const [stdout, , exitCode] = await Promise.all([
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
        process.exited
      ])
      return { stdout, exitCode }
    } finally {
      await Bun.spawn(['rm', '-rf', fixtureRoot]).exited
    }
  }

  it('pins no-circular-core as an error rule in the real config (positive control)', async () => {
    const { stdout, exitCode } = await cruiseSeededCycle('apps/core/src', 'apps')
    expect(stdout).toContain('no-circular-core')
    // error 级违规必须导致非零退出码（降级为 warn 时本断言失败）。
    expect(exitCode).not.toBe(0)
  }, 60_000)

  it('pins no-circular-mnet as an error rule in the real config (positive control)', async () => {
    const { stdout, exitCode } = await cruiseSeededCycle('services/m-net/src', 'services')
    expect(stdout).toContain('no-circular-mnet')
    expect(exitCode).not.toBe(0)
  }, 60_000)
})
