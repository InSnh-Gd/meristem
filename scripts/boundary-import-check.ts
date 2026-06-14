type BoundaryViolation = {
  file: string
  line: number
  importedModule: string
  target: string
}

const trackedSourcePatterns = [
  'apps/**/*.ts',
  'apps/**/*.tsx',
  'services/**/*.ts',
  'services/**/*.tsx',
  'packages/**/*.ts',
  'packages/**/*.tsx'
] as const
const targetPattern = /^(services|packages)\/([^/]+)\/src\/app(?:\.tsx?)?$/
const importPattern =
  /\bimport\s+(?:type\s+)?(?:[\w*$\s{},]+\s+from\s+)?['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]|\bimport\s+[A-Za-z_$][\w$]*\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * 只扫描生产源码目录，测试目录和跨服务公开 barrel 不属于这条边界守卫的阻断范围。
 */
function shouldScanFile(file: string): boolean {
  return !file.includes('/tests/')
}

function toFileUrl(path: string): URL {
  return new URL(`file://${path.endsWith('/') ? path : `${path}/`}`)
}

function toRelativePath(root: string, absolutePath: string): string {
  const normalizedRoot = root.endsWith('/') ? root.slice(0, -1) : root
  return absolutePath.startsWith(`${normalizedRoot}/`)
    ? absolutePath.slice(normalizedRoot.length + 1)
    : absolutePath
}

function resolveImportTarget(rootUrl: URL, file: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  return toRelativePath(
    rootUrl.pathname.replace(/\/$/, ''),
    new URL(specifier, new URL(file, rootUrl)).pathname
  )
}

function getBoundaryOwner(file: string): { kind: 'services' | 'packages'; name: string } | null {
  const match = /^(services|packages)\/([^/]+)\//.exec(file)
  const kind = match?.[1]
  const name = match?.[2]

  if (kind === undefined || name === undefined) return null
  if (kind !== 'services' && kind !== 'packages') return null

  return { kind, name }
}

export async function collectBoundaryViolations(root: string): Promise<BoundaryViolation[]> {
  const rootUrl = toFileUrl(root)
  const files = new Set<string>()

  for (const pattern of trackedSourcePatterns) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: false })) {
      if (shouldScanFile(file)) files.add(file)
    }
  }

  const violations: BoundaryViolation[] = []

  for (const file of [...files].sort()) {
    const text = await Bun.file(`${root}/${file}`).text()

    for (const match of text.matchAll(importPattern)) {
      const importedModule = match[1] ?? match[2] ?? match[3]
      if (importedModule === undefined) continue
      const target = resolveImportTarget(rootUrl, file, importedModule)
      if (target === null) continue

      const targetMatch = targetPattern.exec(target)
      if (!targetMatch) continue

      const targetKind = targetMatch[1]
      const targetName = targetMatch[2]
      if (targetKind === undefined || targetName === undefined) continue
      if (targetKind !== 'services' && targetKind !== 'packages') continue

      const sourceOwner = getBoundaryOwner(file)
      if (
        sourceOwner !== null &&
        sourceOwner.kind === targetKind &&
        sourceOwner.name === targetName
      ) {
        continue
      }

      const line = text.slice(0, match.index ?? 0).split('\n').length
      violations.push({ file, line, importedModule, target })
    }
  }

  return violations
}

function printViolations(violations: BoundaryViolation[]): void {
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line} cross-service app import is forbidden`)
    console.error(`  import: ${violation.importedModule}`)
    console.error(`  target: ${violation.target}`)
  }
}

async function main(): Promise<void> {
  const enforce = Bun.argv.includes('--enforce')
  const violations = await collectBoundaryViolations(process.cwd())

  if (violations.length === 0) {
    console.log('boundary import check: no cross-service app imports found')
    return
  }

  printViolations(violations)
  console.log(
    `boundary import check: found ${violations.length} violation${violations.length === 1 ? '' : 's'} (${enforce ? 'enforcement' : 'discovery'} mode)`
  )

  if (enforce) process.exitCode = 1
}

if (import.meta.main) {
  await main()
}
