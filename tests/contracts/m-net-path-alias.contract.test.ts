import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import type { MNetServiceResult } from '@m-net/types.ts'
import { collectBoundaryViolations, aliasTargets } from '../../scripts/boundary-import-check.ts'

/**
 * `@m-net/*` path alias 的落地守卫（DFW-038 硬前置条件 3）。
 *
 * 别名必须同时被三个消费方解析，任何一方静默失效都会让后续搬迁失去意义：
 * - Bun 运行时（服务与测试如何加载模块）
 * - tsc（typecheck 门禁）
 * - dependency-cruiser（循环/边界规则）
 *
 * 另外 boundary-import-check 只解析 `.` 开头的相对导入；若不教它识别别名，
 * `@m-net/app.ts` 会被静默跳过，跨服务 app.ts 边界守卫形同虚设。
 */

const repoRoot = join(import.meta.dir, '../..')

describe('@m-net path alias contract', () => {
  it('resolves the alias in the Bun runtime', () => {
    const resolved = Bun.resolveSync('@m-net/types.ts', repoRoot)
    expect(resolved).toBe(join(repoRoot, 'services/m-net/src/types.ts'))
  })

  it('resolves the alias at type level (tsc typecheck gate)', () => {
    // 该类型导入走 `@m-net/*`；若 tsc 不解析别名，typecheck 会直接失败。
    const sample: MNetServiceResult<number> = { ok: true, value: 1 }
    expect(sample.ok).toBe(true)
  })

  it('keeps the tsconfig mapping and the guard-script mapping in sync', async () => {
    const tsconfig = (await Bun.file(join(repoRoot, 'tsconfig.base.json')).json()) as {
      compilerOptions?: { paths?: Record<string, string[]> }
    }
    const mapped = tsconfig.compilerOptions?.paths?.['@m-net/*']
    expect(mapped).toEqual(['./services/m-net/src/*'])

    // 真正读取守卫脚本的映射表并断言二者一致：否则 tsconfig 或 aliasTargets 单侧被改
    // 都不会被发现（此前只断言了 tsconfig）。
    const [prefix, target] = aliasTargets[0] ?? []
    expect(prefix).toBe('@m-net/')
    // tsconfig 目标形如 './services/m-net/src/*'；守卫映射形如 ['@m-net/', 'services/m-net/src/']。
    expect(mapped?.[0]).toBe(`./${target}*`)
  })

  it('teaches boundary-import-check to see alias imports across service boundaries', async () => {
    const fixtureRoot = `/tmp/meristem-boundary-alias-${crypto.randomUUID()}`
    try {
      await Bun.write(`${fixtureRoot}/services/m-net/src/app.ts`, 'export const marker = 1\n')
      // 另一个服务经别名导入 m-net 的 app.ts：必须被识别为跨服务边界违规。
      await Bun.write(
        `${fixtureRoot}/services/m-other/src/consumer.ts`,
        "import { marker } from '@m-net/app.ts'\nexport const value = marker\n"
      )
      // 同服务内的别名导入不应被判违规。
      await Bun.write(
        `${fixtureRoot}/services/m-net/src/self.ts`,
        "import { marker } from '@m-net/app.ts'\nexport const value = marker\n"
      )

      const violations = await collectBoundaryViolations(fixtureRoot)
      expect(violations.map(v => `${v.file} -> ${v.target}`)).toEqual([
        'services/m-other/src/consumer.ts -> services/m-net/src/app.ts'
      ])
    } finally {
      await Bun.spawn(['rm', '-rf', fixtureRoot]).exited
    }
  })
})
