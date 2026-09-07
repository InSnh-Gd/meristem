import { existsSync } from 'node:fs'
import { join } from 'node:path'

type WorkspaceHygieneViolation = {
  path: string
  reason: string
}

const LOCAL_RUNTIME_ROOTS = ['.agent-sources', '.codex', '.antigravitycli', 'doc-driven-ai']

/**
 * Classifies paths that should not appear in tracked source or normal review surfaces.
 * 来源：仓库文档清理规则；本扫描器阻止本地运行产物进入正常评审面。
 */
export function findWorkspaceHygieneViolations(
  paths: Iterable<string>
): WorkspaceHygieneViolation[] {
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
  if (segments.includes('.codex')) return 'local Codex runtime output'
  if (segments.includes('.antigravitycli')) return 'local Antigravity CLI runtime output'
  if (segments[0] === 'doc-driven-ai') return 'local doc-driven AI tooling checkout'
  return null
}

/**
 * 收集评审面路径：Git 跟踪文件列表 + 显式检测本地禁止的运行时根目录。
 */
export function collectWorkspacePaths(root: string = process.cwd()): string[] {
  const paths: string[] = []

  const gitResult = Bun.spawnSync(['git', 'ls-files'], { cwd: root })
  if (gitResult.exitCode === 0) {
    const lines = gitResult.stdout.toString().split('\n').filter(Boolean)
    paths.push(...lines)
  }

  for (const runtimeRoot of LOCAL_RUNTIME_ROOTS) {
    if (existsSync(join(root, runtimeRoot))) {
      paths.push(runtimeRoot)
    }
  }

  return paths
}

if (import.meta.main) {
  const violations = findWorkspaceHygieneViolations(collectWorkspacePaths())
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`${violation.path}: ${violation.reason}`)
    }
    process.exit(1)
  }
  console.log('workspace hygiene checks passed')
}
