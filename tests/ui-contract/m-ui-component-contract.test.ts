import { describe, expect, it } from 'bun:test'

const COMPONENTS_ROOT = 'apps/m-ui/src/lib/components'

const FORBIDDEN_COMPONENT_NAMES = [
  'Toast',
  'Snackbar',
  'DecorativeCard',
  'MarketingBanner',
  'Confetti',
  'Carousel',
  'FloatingActionButton',
  'UnscopedDropdownActionMenu',
  'UnlabeledDestructiveIconButton'
] as const

type Violation = {
  filePath: string
  line: number
  componentName: string
  statement: string
}

async function getComponentFiles(): Promise<string[]> {
  const files: string[] = []
  const glob = new Bun.Glob('**/*.svelte')
  for await (const filePath of glob.scan({ cwd: COMPONENTS_ROOT, absolute: false })) {
    files.push(`${COMPONENTS_ROOT}/${filePath}`)
  }
  return files.sort((left, right) => left.localeCompare(right))
}

function findForbiddenImportViolations(filePath: string, source: string): Violation[] {
  const violations: Violation[] = []
  const importLines = source.split('\n')

  importLines.forEach((line, index) => {
    if (!line.includes('import')) return

    for (const componentName of FORBIDDEN_COMPONENT_NAMES) {
      const importPattern = new RegExp(
        `\\bimport\\b[^\\n;]*\\b${componentName}\\b[^\\n;]*\\bfrom\\b`
      )
      if (importPattern.test(line)) {
        violations.push({
          filePath,
          line: index + 1,
          componentName,
          statement: line.trim()
        })
      }
    }
  })

  return violations
}

describe('M-UI component contract: forbidden UI patterns', () => {
  it('rejects import of forbidden component-like names in Svelte components', async () => {
    const files = await getComponentFiles()
    expect(files.length).toBeGreaterThan(0)

    const violations: Violation[] = []
    for (const filePath of files) {
      const source = await Bun.file(filePath).text()
      violations.push(...findForbiddenImportViolations(filePath, source))
    }

    expect(
      violations,
      violations
        .map(
          ({ filePath, line, componentName, statement }) =>
            `${filePath}:${line} -> ${componentName} | ${statement}`
        )
        .join('\n')
    ).toEqual([])
  })
})
