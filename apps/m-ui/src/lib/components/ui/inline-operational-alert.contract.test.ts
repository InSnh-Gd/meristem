import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'InlineOperationalAlert.svelte'),
  'utf8'
)

describe('InlineOperationalAlert source contract', () => {
  it('uses semantic token variables for alert severity mapping', () => {
    expect(source).toContain("warn: 'var(--signal-warn)'")
    expect(source).toContain("risk: 'var(--signal-risk)'")
    expect(source).toContain("block: 'var(--signal-block)'")
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })

  it('keeps inline severity state surfaced through alert styles', () => {
    expect(source).toContain('style:--alert-color={color}')
    expect(source).toContain('role="alert"')
    expect(source).toContain('class="inline-operational-alert"')
  })
})
