import { describe, expect, it } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectWorkspacePaths,
  findWorkspaceHygieneViolations
} from '../../scripts/workspace-hygiene.ts'

describe('workspace hygiene scanner', () => {
  it('rejects backup, generated, dependency, and local runtime paths', () => {
    const violations = findWorkspaceHygieneViolations([
      'apps/core/src/app.ts',
      'apps/core/src/app.ts.bak',
      'apps/m-ui/.svelte-kit/generated/root.js',
      'services/m-log/node_modules/package/index.js',
      '.agent-sources/effect/packages/effect/src/Effect.ts',
      '.codex/uv-tmp/session-cache/index.js',
      '.antigravitycli/state.db',
      'doc-driven-ai/AGENTS.md'
    ])

    expect(violations.map(v => v.path)).toEqual([
      'apps/core/src/app.ts.bak',
      'apps/m-ui/.svelte-kit/generated/root.js',
      'services/m-log/node_modules/package/index.js',
      '.agent-sources/effect/packages/effect/src/Effect.ts',
      '.codex/uv-tmp/session-cache/index.js',
      '.antigravitycli/state.db',
      'doc-driven-ai/AGENTS.md'
    ])
  })

  it('allows normal tracked source, docs, and tests', () => {
    const violations = findWorkspaceHygieneViolations([
      'apps/core/src/routes/projection/projection.ts',
      'services/m-log/src/projection/engine.ts',
      'docs/contracts/CONTRACT-VERSIONING.md',
      'tests/contracts/workspace-hygiene.test.ts'
    ])

    expect(violations).toEqual([])
  })

  it('collects tracked files and discovers prohibited local runtime roots and paths outside scan roots', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'meristem-workspace-hygiene-'))
    try {
      Bun.spawnSync(['git', 'init'], { cwd: tempRoot })
      Bun.spawnSync(['git', 'config', 'user.name', 'test'], { cwd: tempRoot })
      Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: tempRoot })

      await mkdir(join(tempRoot, 'ops'), { recursive: true })
      await mkdir(join(tempRoot, '.codex'), { recursive: true })
      await mkdir(join(tempRoot, '.agent-sources'), { recursive: true })
      await mkdir(join(tempRoot, 'doc-driven-ai'), { recursive: true })
      await mkdir(join(tempRoot, '.antigravitycli'), { recursive: true })

      await writeFile(join(tempRoot, 'ops/sample.bak'), 'backup')
      await writeFile(join(tempRoot, 'root-artifact.tmp'), 'tmp')
      await writeFile(join(tempRoot, 'clean-file.ts'), 'export const a = 1')

      Bun.spawnSync(['git', 'add', 'ops/sample.bak', 'root-artifact.tmp', 'clean-file.ts'], {
        cwd: tempRoot
      })

      const collected = collectWorkspacePaths(tempRoot)
      const violations = findWorkspaceHygieneViolations(collected)

      expect(violations).toEqual([
        { path: 'ops/sample.bak', reason: 'backup file' },
        { path: 'root-artifact.tmp', reason: 'temporary file' },
        { path: '.agent-sources', reason: 'local agent source mirror' },
        { path: '.codex', reason: 'local Codex runtime output' },
        { path: '.antigravitycli', reason: 'local Antigravity CLI runtime output' },
        { path: 'doc-driven-ai', reason: 'local doc-driven AI tooling checkout' }
      ])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('collects tracked files and finds no violations in a clean repository', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'meristem-workspace-hygiene-clean-'))
    try {
      Bun.spawnSync(['git', 'init'], { cwd: tempRoot })
      Bun.spawnSync(['git', 'config', 'user.name', 'test'], { cwd: tempRoot })
      Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: tempRoot })

      await mkdir(join(tempRoot, 'apps/core/src'), { recursive: true })
      await mkdir(join(tempRoot, 'docs/contracts'), { recursive: true })
      await writeFile(join(tempRoot, 'apps/core/src/index.ts'), 'console.log("hello")')
      await writeFile(join(tempRoot, 'docs/contracts/API.md'), '# API')

      Bun.spawnSync(['git', 'add', 'apps/core/src/index.ts', 'docs/contracts/API.md'], {
        cwd: tempRoot
      })

      const collected = collectWorkspacePaths(tempRoot)
      const violations = findWorkspaceHygieneViolations(collected)

      expect(violations).toEqual([])
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('runs CLI subprocess on clean and dirty workspaces correctly', async () => {
    const scriptPath = join(process.cwd(), 'scripts/workspace-hygiene.ts')

    const cleanRoot = await mkdtemp(join(tmpdir(), 'meristem-workspace-cli-clean-'))
    const dirtyRoot = await mkdtemp(join(tmpdir(), 'meristem-workspace-cli-dirty-'))
    try {
      Bun.spawnSync(['git', 'init'], { cwd: cleanRoot })
      Bun.spawnSync(['git', 'config', 'user.name', 'test'], { cwd: cleanRoot })
      Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: cleanRoot })
      await writeFile(join(cleanRoot, 'valid.ts'), 'export const x = 1')
      Bun.spawnSync(['git', 'add', 'valid.ts'], { cwd: cleanRoot })

      const cleanRun = Bun.spawnSync(['bun', 'run', scriptPath], { cwd: cleanRoot })
      expect(cleanRun.exitCode).toBe(0)
      expect(cleanRun.stdout.toString()).toContain('workspace hygiene checks passed')

      Bun.spawnSync(['git', 'init'], { cwd: dirtyRoot })
      Bun.spawnSync(['git', 'config', 'user.name', 'test'], { cwd: dirtyRoot })
      Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: dirtyRoot })
      await writeFile(join(dirtyRoot, 'temp.tmp'), 'junk')
      Bun.spawnSync(['git', 'add', 'temp.tmp'], { cwd: dirtyRoot })

      const dirtyRun = Bun.spawnSync(['bun', 'run', scriptPath], { cwd: dirtyRoot })
      expect(dirtyRun.exitCode).toBe(1)
      expect(dirtyRun.stderr.toString()).toContain('temp.tmp: temporary file')
    } finally {
      await rm(cleanRoot, { recursive: true, force: true })
      await rm(dirtyRoot, { recursive: true, force: true })
    }
  })
})
