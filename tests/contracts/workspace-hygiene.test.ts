import { describe, expect, it } from 'bun:test'
import { findWorkspaceHygieneViolations } from '../../scripts/workspace-hygiene.ts'

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
      'apps/core/src/routes/projection.ts',
      'services/m-log/src/projection/engine.ts',
      'docs/contracts/CONTRACT-VERSIONING.md',
      'tests/contracts/workspace-hygiene.test.ts'
    ])

    expect(violations).toEqual([])
  })
})
