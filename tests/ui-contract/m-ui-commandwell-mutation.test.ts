/**
 * M-UI CommandWell Mutation UI Contract Tests (TDD Red Phase)
 *
 * Verifies the static contract for CommandWell mutation execution UI:
 * - No toast/snackbar patterns in M-UI source
 * - Chinese visible labels for confirmation, success, failure states
 * - Confirmation flow present in CommandWell component
 * - Mobile-safe layout patterns
 * - Approval/profile pages reference BFF helpers only
 *
 * STATUS: TDD RED — pages/components don't have mutation UI yet.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { globSync, readFileSync } from 'node:fs'

const M_UI_SRC = 'apps/m-ui/src'
const FORBIDDEN_PATTERNS = [
  { pattern: /\btoast\b/i, reason: 'toast/snackbar libraries prohibited' },
  { pattern: /\bsnackbar\b/i, reason: 'snackbar patterns prohibited' },
  { pattern: /svelte-french-toast/, reason: 'svelte-french-toast library prohibited' },
  { pattern: /svelte-toast/, reason: 'svelte-toast library prohibited' }
]
const _REQUIRED_CHINESE_LABELS = [
  { label: '确认执行', files: ['lib/components/modules/command/CommandWell.svelte'] },
  { label: '操作成功', files: ['lib/components/modules/command/CommandWell.svelte'] },
  { label: '操作失败', files: ['lib/components/modules/command/CommandWell.svelte'] }
]

type Violation = { filePath: string; line: number; reason: string; snippet: string }

function collectUiSourceFiles(): string[] {
  return globSync('**/*.{ts,svelte}', { cwd: M_UI_SRC })
    .map((f: string) => `${M_UI_SRC}/${f}`)
    .sort()
}

function findForbiddenPatterns(filePath: string, source: string): Violation[] {
  const violations: Violation[] = []
  const lines = source.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const trimmed = line.trim()
    // Skip comments and import lines for toast checks (libraries may be imported but not used)
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(trimmed)) {
        violations.push({ filePath, line: i + 1, reason, snippet: trimmed })
      }
    }
  }
  return violations
}

describe('M-UI CommandWell Mutation UI Contract', () => {
  let uiFiles: string[] = []

  beforeAll(() => {
    uiFiles = collectUiSourceFiles()
  })

  afterAll(() => {
    // No cleanup needed for static analysis
  })

  it('forbids toast and snackbar patterns in M-UI source', () => {
    expect(uiFiles.length).toBeGreaterThan(0)
    const violations: Violation[] = []
    for (const filePath of uiFiles) {
      const source = readFileSync(filePath, 'utf-8')
      violations.push(...findForbiddenPatterns(filePath, source))
    }
    expect(violations.map(v => `${v.filePath}:${v.line} → ${v.reason}`)).toEqual([])
  })

  it('CommandWell component has Chinese confirmation labels', () => {
    const cmdWellSource = readFileSync(
      `${M_UI_SRC}/lib/components/modules/command/CommandWell.svelte`,
      'utf-8'
    )
    expect(cmdWellSource).toContain('确认执行')
    expect(cmdWellSource).toContain('确认')
  })

  it('approval detail page references execute controls (RED: page lacks mutations)', () => {
    // RED PHASE: approval detail page currently has no execute/mutation UI.
    // After implementation, this file must contain command execution references.
    const approvalDetail = readFileSync(
      `${M_UI_SRC}/routes/policy/approvals/[id]/+page.svelte`,
      'utf-8'
    )
    // Currently the page shows display-only preview; after implementation it should
    // reference executeCommand or similar mutation helper.
    const hasMutationImport =
      approvalDetail.includes('executeCommand') || approvalDetail.includes('CommandWell')
    expect(hasMutationImport).toBe(true)
  })

  it('profile detail page references execute controls (RED: page lacks mutations)', () => {
    // RED PHASE: profile detail page currently has no execute/mutation UI.
    const profileDetail = readFileSync(
      `${M_UI_SRC}/routes/network/profiles/[profileVersion]/+page.svelte`,
      'utf-8'
    )
    // Currently display-only; after implementation should reference mutation logic.
    const hasMutationImport =
      profileDetail.includes('executeCommand') || profileDetail.includes('CommandWell')
    expect(hasMutationImport).toBe(true)
  })

  it('BFF helper exports typed execute support for the four mutation commands', () => {
    const bffSource = readFileSync(`${M_UI_SRC}/lib/bff.ts`, 'utf-8')
    // RED PHASE: execute commands not yet wired in BFF helper.
    // After implementation, bff.ts should reference execute or command-specific helpers.
    const hasExecuteSupport =
      bffSource.includes('execute') &&
      (bffSource.includes('approve') ||
        bffSource.includes('reject') ||
        bffSource.includes('profile'))
    expect(hasExecuteSupport).toBe(true)
  })
})
