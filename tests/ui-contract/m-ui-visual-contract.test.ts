import { describe, expect, it } from 'bun:test'

const COMPONENTS_ROOT = 'apps/m-ui/src/lib/components'

type Violation = {
  filePath: string
  line: number
  token: string
  snippet: string
}

const RAW_COLOR_PATTERN = /#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\([^\n)]*\)/g
const STYLE_BLOCK_PATTERN = /<style\b[^>]*>([\s\S]*?)<\/style>/g

async function getComponentFiles(): Promise<string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('**/*.svelte')
  for await (const filePath of glob.scan({ cwd: COMPONENTS_ROOT, absolute: false })) {
    files.push(`${COMPONENTS_ROOT}/${filePath}`)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function countNewlines(text: string): number {
  return (text.match(/\n/g) ?? []).length
}

function isCustomPropertyDefinition(line: string): boolean {
  return /^\s*--[-\w]+\s*:/.test(line)
}

function getRawColorViolations(filePath: string, source: string): Violation[] {
  const violations: Violation[] = []
  const styleBlocks = source.matchAll(STYLE_BLOCK_PATTERN)

  for (const styleBlock of styleBlocks) {
    const styleContent = styleBlock[1]
    const fullMatch = styleBlock[0]
    if (typeof styleContent !== 'string') {
      continue
    }
    const blockStartIndex = styleBlock.index ?? 0
    const styleStartIndex = blockStartIndex + fullMatch.indexOf(styleContent)
    const styleStartLine = countNewlines(source.slice(0, styleStartIndex)) + 1

    const normalizedStyle = styleContent.replace(/\/\*[\s\S]*?\*\//g, '')
    const lines = normalizedStyle.split('\n')

    lines.forEach((line, index) => {
      if (isCustomPropertyDefinition(line)) return

      const matches = line.matchAll(RAW_COLOR_PATTERN)
      for (const match of matches) {
        const token = match[0]
        violations.push({
          filePath,
          line: styleStartLine + index,
          token,
          snippet: line.trim()
        })
      }
    })
  }

  return violations
}

describe('M-UI visual contract: component styles use design tokens', () => {
  it('rejects raw hex/rgb/hsl colors outside CSS custom property definitions', async () => {
    const files = await getComponentFiles()
    expect(files.length).toBeGreaterThan(0)

    const violations: Violation[] = []
    for (const filePath of files) {
      const source = await Bun.file(filePath).text()
      violations.push(...getRawColorViolations(filePath, source))
    }

    expect(
      violations,
      violations
        .map(({ filePath, line, token, snippet }) => `${filePath}:${line} -> ${token} | ${snippet}`)
        .join('\n')
    ).toEqual([])
  })
})
