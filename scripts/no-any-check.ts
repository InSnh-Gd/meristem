// no-any 检查作为最轻量的静态门禁，优先阻断领域层和边界层偷懒回退到 any。
const paths = ['apps', 'services', 'packages', 'tests']
const anyPattern = /\bany\b/
const allowed = new Set<string>()
let failed = false

/**
 * Bun.Glob 递归扫描受控目录，避免引入 Node.js 文件系统 API。
 */
async function* walk(path: string): AsyncGenerator<string> {
  for await (const entry of new Bun.Glob(`${path}/**/*.ts`).scan('.')) {
    yield entry
  }
}

// 逐行报告违规位置，方便在 PR 或本地终端中直接定位。
for (const root of paths) {
  for await (const file of walk(root)) {
    if (allowed.has(file)) continue
    const text = await Bun.file(file).text()
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      if (anyPattern.test(line)) {
        failed = true
        console.error(`${file}:${index + 1}: forbidden any`)
      }
    })
  }
}

if (failed) process.exit(1)
console.log('no forbidden any usage found')

export {}
