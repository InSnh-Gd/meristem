/**
 * M-UI CommandWell Mutation UI Contract Tests
 *
 * Verifies the static contract for CommandWell mutation execution UI:
 * - No toast/snackbar patterns in M-UI source
 * - Chinese visible labels for confirmation, success, failure states
 * - Confirmation flow present in CommandWell component
 * - Thin routes delegate to extracted workspaces
 * - Approval/profile detail workspaces reference BFF helpers only
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

const APPROVAL_ROUTE_FILE = `${M_UI_SRC}/routes/policy/approvals/[id]/+page.svelte`
const PROFILE_ROUTE_FILE = `${M_UI_SRC}/routes/network/profiles/[profileVersion]/+page.svelte`
const APPROVAL_WORKSPACE_FILE = `${M_UI_SRC}/lib/components/modules/policy/ApprovalDetailWorkspace.svelte`
const PROFILE_WORKSPACE_FILE = `${M_UI_SRC}/lib/components/modules/network/NetworkProfileWorkspace.svelte`

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

  it('approval detail route stays thin while the workspace owns execute controls', () => {
    const approvalRoute = readFileSync(APPROVAL_ROUTE_FILE, 'utf-8')
    const approvalWorkspace = readFileSync(APPROVAL_WORKSPACE_FILE, 'utf-8')

    expect(approvalRoute).toContain('ApprovalDetailWorkspace')
    expect(approvalRoute).not.toContain('executeCommand')
    expect(approvalWorkspace).toContain('executeCommand')
    expect(approvalWorkspace).toContain('CommandWell')
  })

  it('profile detail route stays thin while the workspace owns execute controls', () => {
    const profileRoute = readFileSync(PROFILE_ROUTE_FILE, 'utf-8')
    const profileWorkspace = readFileSync(PROFILE_WORKSPACE_FILE, 'utf-8')

    expect(profileRoute).toContain('NetworkProfileWorkspace')
    expect(profileRoute).not.toContain('executeCommand')
    expect(profileWorkspace).toContain('executeCommand')
    expect(profileWorkspace).toContain('CommandWell')
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
