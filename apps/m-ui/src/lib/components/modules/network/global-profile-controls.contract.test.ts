import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'GlobalProfileControls.svelte'),
  'utf8'
)

describe('GlobalProfileControls source contract', () => {
  it('keeps BFF-only global control loading path', () => {
    expect(source).toContain('fetchGlobalDefaults')
    expect(source).toContain('fetchMigrationStatus')
    expect(source).toContain('muiStores.token')
    expect(source).toContain('页面不直接命中 Core 或 M-Net')
  })

  it('keeps degraded and status failure alerts visible', () => {
    expect(source).toContain('全局 Profile 控制状态加载失败')
    expect(source).toContain('迁移状态加载失败')
    expect(source).toContain('<InlineOperationalAlert message={error} severity="block" />')
    expect(source).toContain('<InlineOperationalAlert message={statusError} severity="risk" />')
  })

  it('keeps disabled command surfaces non-executable in the transitional workbench', () => {
    expect(source).toContain('演示界面只展示控制命令，未启用前端执行。')
    expect(source).toContain('演示中不触发全局切换')
    expect(source).toContain('break-glass disable（演示中禁用）')
  })
})
