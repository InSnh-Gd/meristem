import { describe, expect, it } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 目录分层守卫（DFW-038 / DFW-034）。
 *
 * 分层完成后，两个曾经的巨型平铺目录各自收敛到「少量横切模块 + 若干领域子目录」。
 * 本守卫锁定该终态，防止新增文件悄悄退回到平铺形态（或把横切模块塞进 src 根）：
 * - `services/m-net/src`：根只允许横切模块与入口文件；领域文件必须落在 6 个冻结子目录内。
 * - `apps/core/src/routes`：不允许平铺；
 * - `apps/core/src`：storage-adapter* 必须落在 `storage/`。
 *
 * 阈值留出少量余量（新增一个真正的横切模块可接受），但明显膨胀会失败并提示归类。
 */

const repoRoot = join(import.meta.dir, '../..')

function flatTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => entry.name)
    .sort()
}

const MNET_FROZEN_DIRS = [
  'profile',
  'closed-loop',
  'migration',
  'agent',
  'forced-relay',
  'data-plane'
] as const

describe('directory layering guard', () => {
  it('keeps services/m-net/src root at cross-cutting modules only', () => {
    const srcDir = join(repoRoot, 'services/m-net/src')
    const rootFiles = flatTsFiles(srcDir)
    // 基线 27 个横切模块；允许新增 3 个真正的横切模块，超出即提示归类到领域子目录。
    expect(rootFiles.length).toBeLessThanOrEqual(30)

    // 冻结的 6 个领域子目录必须存在。
    const dirs = new Set(
      readdirSync(srcDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    )
    for (const frozen of MNET_FROZEN_DIRS) {
      expect(dirs.has(frozen)).toBe(true)
    }
  })

  it('keeps apps/core/src/routes free of flat files', () => {
    const routesDir = join(repoRoot, 'apps/core/src/routes')
    expect(flatTsFiles(routesDir)).toEqual([])
  })

  it('keeps apps/core storage adapters under storage/', () => {
    const srcDir = join(repoRoot, 'apps/core/src')
    const strayStorageFiles = flatTsFiles(srcDir).filter(name => name.startsWith('storage-adapter'))
    expect(strayStorageFiles).toEqual([])
  })
})
