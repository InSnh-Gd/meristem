const paths = ['apps', 'services', 'packages', 'tests']
const anyPattern = /\bany\b/
const allowed = new Set<string>()
let failed = false

async function* walk(path: string): AsyncGenerator<string> {
  for await (const entry of new Bun.Glob(`${path}/**/*.ts`).scan('.')) {
    yield entry
  }
}

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
