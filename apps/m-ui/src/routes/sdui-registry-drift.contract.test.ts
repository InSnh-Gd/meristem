import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TEST_DIR = dirname(fileURLToPath(import.meta.url))
const COMPONENTS_DIR = resolve(TEST_DIR, '../lib/components')

const registrySource = readFileSync(
  resolve(TEST_DIR, '../../../../services/m-ui-bff/src/routes/route-registry.ts'),
  'utf8'
)

const uiSchemaSource = readFileSync(
  resolve(TEST_DIR, '../../../../packages/contracts/src/schemas/ui.ts'),
  'utf8'
)

describe('SDUI registry drift contracts', () => {
  it('declares TraceLink only on the route with stable timeline correlation data', () => {
    const traceLinkMatches = [...registrySource.matchAll(/kind: 'TraceLink'/g)]

    expect(traceLinkMatches).toHaveLength(1)
    expect(registrySource).toContain("id: 'timeline.index'")
    expect(registrySource).toContain("id: 'timeline-trace-link'")
  })

  it('does not allow legacy component kinds without an M-UI implementation', () => {
    for (const orphanKind of [
      'TimelinePanel',
      'NodeListPanel',
      'NodeDetailPanel',
      'ServiceListPanel'
    ]) {
      expect(uiSchemaSource).not.toContain(`'${orphanKind}'`)
      expect(registrySource).not.toContain(`kind: '${orphanKind}'`)
    }
  })

  it('keeps nodes.index registry aligned with the actual inline route structure', () => {
    expect(registrySource).toContain("id: 'nodes.index'")
    expect(registrySource).toContain("kind: 'FilterBar'")
    expect(registrySource).toContain("kind: 'KeyValueInspector'")
  })

  it('every registry component kind maps to a real Svelte component file', () => {
    // Extract all unique component kind values from the registry source
    const kindMatches = [...registrySource.matchAll(/kind: '([A-Za-z]+)'/g)]
    const registryKinds = [...new Set(kindMatches.map(m => m[1]))].sort()

    for (const kind of registryKinds) {
      const filename = kind === 'CommandWellPanel' ? 'CommandWell' : kind
      // Check file existence via relative path strategy: search in known module dirs
      const possiblePaths = [
        resolve(COMPONENTS_DIR, 'ui', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'layout', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'modules', 'audit', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'modules', 'command', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'modules', 'control-room', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'modules', 'network', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'modules', 'nodes', `${filename}.svelte`),
        resolve(COMPONENTS_DIR, 'modules', 'policy', `${filename}.svelte`)
      ]

      const found = possiblePaths.some(p => existsSync(p))
      expect(
        found,
        `Registry kind '${kind}' has no corresponding Svelte file (${filename}.svelte)`
      ).toBe(true)
    }
  })
})
