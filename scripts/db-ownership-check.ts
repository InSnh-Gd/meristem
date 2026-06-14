import ts from 'typescript'
import {
  approvedExceptionTablesForFile,
  isDbOwnedTable,
  sourceDomainForFile,
  tableOwners,
  type DbOwnedTable,
  type DbOwnerDomain
} from './db-ownership-allowlist.ts'

export type DbOwnershipViolation = {
  file: string
  line: number
  table: string
  owner: DbOwnerDomain
  importer: DbOwnerDomain
}

const trackedSourcePatterns = [
  'apps/core/src/**/*.ts',
  'services/*/src/**/*.ts',
  'packages/*/src/**/*.ts'
] as const

const schemaBarrelSpecifierPattern = /(?:^|\/)packages\/db\/src\/schema\.ts$/
const schemaOwnerModuleSpecifierPattern = /(?:^|\/)packages\/db\/src\/schema\/[^/]+\.ts$/

/**
 * 生产源码边界守卫不扫描测试目录；测试通过临时 fixture 根目录驱动脚本行为。
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
  if (specifier.startsWith('.')) {
    return toRelativePath(
      rootUrl.pathname.replace(/\/$/, ''),
      new URL(specifier, new URL(file, rootUrl)).pathname
    )
  }

  return specifier
}

function isSchemaImportTarget(target: string): boolean {
  return schemaBarrelSpecifierPattern.test(target) || schemaOwnerModuleSpecifierPattern.test(target)
}

function collectImportedTableNames(statement: ts.ImportDeclaration): DbOwnedTable[] {
  const clause = statement.importClause
  if (!clause?.namedBindings) return []
  if (!ts.isNamedImports(clause.namedBindings)) return []

  return clause.namedBindings.elements
    .map(element => element.propertyName?.text ?? element.name.text)
    .filter(isDbOwnedTable)
}

function lineNumberForPosition(text: string, start: number): number {
  return text.slice(0, start).split('\n').length
}

export async function collectDbOwnershipViolations(root: string): Promise<DbOwnershipViolation[]> {
  const rootUrl = toFileUrl(root)
  const files = new Set<string>()

  for (const pattern of trackedSourcePatterns) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: root, absolute: false })) {
      if (shouldScanFile(file)) files.add(file)
    }
  }

  const violations: DbOwnershipViolation[] = []

  for (const file of [...files].sort()) {
    const importer = sourceDomainForFile(file)
    if (importer === null) continue

    const text = await Bun.file(`${root}/${file}`).text()
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    )
    const approvedTables = approvedExceptionTablesForFile(file)

    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue

      const target = resolveImportTarget(rootUrl, file, statement.moduleSpecifier.text)
      if (target === null || !isSchemaImportTarget(target)) continue

      for (const table of collectImportedTableNames(statement)) {
        const owner = tableOwners[table]
        if (owner === importer) continue
        if (approvedTables.has(table)) continue

        violations.push({
          file,
          line: lineNumberForPosition(text, statement.getStart(sourceFile)),
          table,
          owner,
          importer
        })
      }
    }
  }

  return violations
}

function printViolations(violations: readonly DbOwnershipViolation[]): void {
  for (const violation of violations) {
    console.error(
      `${violation.file}:${violation.line} unapproved cross-owner table read is forbidden`
    )
    console.error(`  table: ${violation.table}`)
    console.error(`  owner: ${violation.owner}`)
    console.error(`  importer: ${violation.importer}`)
  }
}

async function main(): Promise<void> {
  const enforce = Bun.argv.includes('--enforce')
  const violations = await collectDbOwnershipViolations(process.cwd())

  if (violations.length === 0) {
    console.log('db ownership check: no unapproved cross-owner table reads found')
    return
  }

  printViolations(violations)
  console.log(
    `db ownership check: found ${violations.length} violation${violations.length === 1 ? '' : 's'} (${enforce ? 'enforcement' : 'discovery'} mode)`
  )

  if (enforce) process.exitCode = 1
}

if (import.meta.main) {
  await main()
}
