import { execSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Bits UI Boundary', () => {
  it('ensures bits-ui is only imported in apps/m-ui/src/lib/components/ui/ (Gate 4)', () => {
    // 定位 apps/m-ui/src，避免依赖 __dirname 所在的源码子目录
    const srcDir = path.resolve(process.cwd(), 'src')

    // 拆分字面量避免匹配到本测试自身
    const searchString = "from 'bits" + "-ui'"

    // grep 无匹配时返回 1，用 `|| true` 保证不抛错
    const output = execSync(`grep -rn "${searchString}" ${srcDir} || true`, {
      encoding: 'utf-8'
    })

    const lines = output.split('\n').filter(Boolean)

    // 每个匹配都必须落在 src/lib/components/ui/ 下
    for (const line of lines) {
      const filePath = line.split(':')[0]
      if (filePath && !filePath.includes('bits-ui-boundary.contract.test.ts')) {
        const isAllowed = filePath.includes('src/lib/components/ui/')
        expect(isAllowed, `Found forbidden bits-ui import in ${filePath}`).toBe(true)
      }
    }
  })
})
