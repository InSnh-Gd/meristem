import { describe, expect, it } from 'bun:test'

const M_UI_SRC_ROOT = 'apps/m-ui/src'
const ALLOWED_BFF_URL = 'http://localhost:3200'
const FORBIDDEN_CORE_URL = 'http://localhost:3000'
const APPROVAL_PROFILE_BFF_CALLS = ['/api/v0/policy/approvals', '/api/v0/network-profiles'] as const

type Violation = {
  filePath: string
  line: number
  reason: string
  snippet: string
}

async function getUiSourceFiles(): Promise<string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('**/*.{ts,svelte,js}')
  for await (const filePath of glob.scan({ cwd: M_UI_SRC_ROOT, absolute: false })) {
    files.push(`${M_UI_SRC_ROOT}/${filePath}`)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function findBoundaryViolations(filePath: string, source: string): Violation[] {
  const violations: Violation[] = []
  const lines = source.split('\n')

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    const surroundingContext = lines.slice(Math.max(0, index - 2), index + 1).join('\n')

    if (trimmed.includes(FORBIDDEN_CORE_URL)) {
      violations.push({
        filePath,
        line: index + 1,
        reason: `M-UI must not call Core URL directly (${FORBIDDEN_CORE_URL})`,
        snippet: trimmed
      })
      return
    }

    const hasApiV0LiteralWithoutBffPrefix = /([`'"])\/api\/v0[^`'"]*\1/.test(trimmed)
    // bffFetch() 内部用 '/api/v0/...' 是合法模式：它通过 BFF_URL 前缀走 BFF 代理。
    // 这里同时接受多行调用格式，避免 prettier 换行后把模板字面量误判成越界调用。
    const isBffFetchCall = /\bbffFetch\b/.test(surroundingContext)
    if (hasApiV0LiteralWithoutBffPrefix && !isBffFetchCall) {
      violations.push({
        filePath,
        line: index + 1,
        reason:
          "M-UI must not reference '/api/v0' literal directly; route through explicit BFF-prefixed URL boundary",
        snippet: trimmed
      })
    }
  })

  return violations
}

describe('M-UI BFF boundary contract', () => {
  it('allows BFF URL and rejects direct Core URL or direct /api/v0 fetches', async () => {
    expect(ALLOWED_BFF_URL).toBe('http://localhost:3200')

    const files = await getUiSourceFiles()
    expect(files.length).toBeGreaterThan(0)

    const violations: Violation[] = []
    for (const filePath of files) {
      const source = await Bun.file(filePath).text()
      violations.push(...findBoundaryViolations(filePath, source))
    }

    expect(
      violations,
      violations
        .map(
          ({ filePath, line, reason, snippet }) => `${filePath}:${line} -> ${reason} | ${snippet}`
        )
        .join('\n')
    ).toEqual([])
  })

  it('approval/profile UI data access stays behind BFF helper calls', async () => {
    const bffModule = await Bun.file('apps/m-ui/src/lib/bff.ts').text()

    for (const path of APPROVAL_PROFILE_BFF_CALLS) {
      expect(bffModule).toContain(`bffFetch<`)
      expect(bffModule).toContain(path)
    }
  })
})
