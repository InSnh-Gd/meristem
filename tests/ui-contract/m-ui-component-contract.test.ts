import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  SduiV02ComponentKindSchema,
  SduiV02RouteRegistrySchema
} from '../../packages/contracts/src/schemas/ui.ts'

const COMPONENTS_ROOT = 'apps/m-ui/src/lib/components'

const DISPLAY_ONLY_ROUTE_FILES = ['apps/m-ui/src/routes/policy/approvals/+page.svelte'] as const

const DETAIL_WORKSPACE_FILES = [
  'apps/m-ui/src/lib/components/modules/policy/ApprovalDetailWorkspace.svelte',
  'apps/m-ui/src/lib/components/modules/network/NetworkProfileWorkspace.svelte'
] as const

const FORBIDDEN_COMPONENT_NAMES = [
  // UI anti-patterns that must never appear as SDUI component kinds
  'Toast',
  'Snackbar',
  'DecorativeCard',
  'MarketingBanner',
  'Confetti',
  'Carousel',
  'FloatingActionButton',
  'UnscopedDropdownActionMenu',
  'UnlabeledDestructiveIconButton',
  // Orphan kinds removed during SDUI v0.2 registry lock — must not return
  'TimelinePanel',
  'NodeListPanel',
  'NodeDetailPanel',
  'ServiceListPanel'
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

  it('approval queue route keeps preview commands non-executable and avoids hidden action forms', async () => {
    const forbiddenTokens = ['<form', 'type="submit"', '/execute', 'fetch('] as const

    for (const filePath of DISPLAY_ONLY_ROUTE_FILES) {
      const source = await Bun.file(filePath).text()
      expect(source).toContain('OperationalCommandPreview')
      for (const token of forbiddenTokens) {
        expect(source, `${filePath} should not contain ${token}`).not.toContain(token)
      }
    }
  })

  it('approval/profile detail workspaces keep preview visibility while owning BFF-backed command execution', async () => {
    const forbiddenTokens = ['<form', 'type="submit"', '/execute', 'fetch('] as const

    for (const filePath of DETAIL_WORKSPACE_FILES) {
      const source = await Bun.file(filePath).text()
      expect(source).toContain('OperationalCommandPreview')
      expect(source).toContain('executeCommand')
      for (const token of forbiddenTokens) {
        expect(source, `${filePath} should not contain ${token}`).not.toContain(token)
      }
    }
  })

  it('unknown component kinds fail closed and forbidden components are rejected by SDUI schema', () => {
    // Check an unknown component
    const decodeRoute = Schema.decodeUnknownEither(SduiV02RouteRegistrySchema)
    const badRegistry = {
      schemaVersion: 'sdui@0.2.0',
      routes: [
        {
          id: 'test.route',
          title: 'Test',
          requiredPermissions: ['core:read'],
          stateSources: ['authoritative'],
          degradedState: { enabled: true, reason: 'test' },
          components: [{ kind: 'UnknownPanel', id: 'unknown' }]
        }
      ]
    }

    const result = decodeRoute(badRegistry)
    expect(result._tag).toBe('Left')

    // Check forbidden components are rejected
    FORBIDDEN_COMPONENT_NAMES.forEach(forbidden => {
      const isForbiddenAccepted = Schema.decodeUnknownEither(SduiV02ComponentKindSchema)(forbidden)
      expect(isForbiddenAccepted._tag).toBe('Left')
    })
  })
})
