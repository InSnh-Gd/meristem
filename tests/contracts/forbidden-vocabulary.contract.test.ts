import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// 为避免守卫自身命中禁词，运行时拼接检索词而非字面书写
// （若直接写入禁词字面量，守卫会自检失败且后续 grep 也会误命中自身）
const bannedToken = ['ph', 'ase'].join('')
const bannedRe = new RegExp(bannedToken, 'i')

const SCAN_ROOTS = ['apps', 'services', 'packages', 'scripts', 'tests']
const SCAN_EXTS = new Set(['.ts', '.svelte'])
const EXCLUDED_DIR_PARTS = new Set(['node_modules', '.svelte-kit', 'build', 'coverage', 'dist'])

function isExcludedDir(name: string): boolean {
  return EXCLUDED_DIR_PARTS.has(name)
}

function shouldScanFile(fileName: string): boolean {
  if (fileName.endsWith('.md')) return false
  const dot = fileName.lastIndexOf('.')
  if (dot === -1) return false
  const ext = fileName.slice(dot)
  return SCAN_EXTS.has(ext)
}

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (isExcludedDir(entry)) continue
    const full = join(dir, entry)
    let st: ReturnType<typeof statSync>
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      walk(full, out)
    } else if (st.isFile() && shouldScanFile(entry)) {
      out.push(full)
    }
  }
}

describe('forbidden vocabulary guard', () => {
  it('代码、文件名和代码注释中不得出现禁词', () => {
    const repoRoot = join(import.meta.dir, '../..')
    const files: string[] = []
    for (const root of SCAN_ROOTS) {
      walk(join(repoRoot, root), files)
    }

    const hits: string[] = []

    for (const absPath of files) {
      const rel = relative(repoRoot, absPath)

      // 文件名检查
      if (bannedRe.test(rel)) {
        hits.push(`${rel}:1: filename contains forbidden vocabulary -> ${rel}`)
      }

      let content: string
      try {
        content = readFileSync(absPath, 'utf-8')
      } catch {
        continue
      }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (bannedRe.test(lines[i] ?? '')) {
          hits.push(`${rel}:${i + 1}: ${lines[i]?.trim()}`)
        }
      }
    }

    // 过滤：守卫文件自身的动态 token 构造行不应被视为命中？
    // 实际上 bannedRe 不会命中 ['ph','ase'] 的拼接写法，天然自豁免
    // 但为稳妥，若 hits 全来自 guard 文件的 token 定义行，则忽略 — 当前实现无需忽略
    if (hits.length > 0) {
      // 按路径排序，保证输出稳定
      hits.sort()
    }

    expect(hits, `发现禁词命中 (${hits.length}):\n${hits.join('\n')}`).toEqual([])
  })
})
