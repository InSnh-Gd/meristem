type WorkspaceHygieneViolation = {
  path: string
  reason: string
}

const DEFAULT_SCAN_ROOTS = ['apps', 'services', 'packages', 'tests', 'docs', 'scripts']

/**
 * Classifies paths that should not appear in tracked source or normal review surfaces.
 * Source: docs/plans/2026-05-23-architecture-review-register.md A-006.
 */
export function findWorkspaceHygieneViolations(paths: Iterable<string>): WorkspaceHygieneViolation[] {
  const violations: WorkspaceHygieneViolation[] = []
  for (const path of paths) {
    const reason = classifyWorkspacePath(path)
    if (reason) violations.push({ path, reason })
  }
  return violations
}

function classifyWorkspacePath(path: string): string | null {
  const segments = path.split('/')
  const basename = segments[segments.length - 1] ?? path
  if (basename.endsWith('.bak')) return 'backup file'
  if (basename.endsWith('.tmp')) return 'temporary file'
  if (basename.endsWith('.orig')) return 'merge backup file'
  if (segments.includes('.svelte-kit')) return 'generated SvelteKit output'
  if (segments.includes('node_modules')) return 'dependency install output'
  if (segments.includes('.agent-sources')) return 'local agent source mirror'
  return null
}

async function collectWorkspacePaths(): Promise<string[]> {
  const paths: string[] = []
  const rootGlobs = DEFAULT_SCAN_ROOTS.map((root) => `${root}/**/*`)
  rootGlobs.push('.agent-sources/**/*')

  for (const pattern of rootGlobs) {
    for await (const entry of new Bun.Glob(pattern).scan('.')) {
      paths.push(entry)
    }
  }

  return paths
}

if (import.meta.main) {
  const violations = findWorkspaceHygieneViolations(await collectWorkspacePaths())
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.path}: ${violation.reason}`)
    }
    process.exit(1)
  }
  console.log('workspace hygiene checks passed')
}

