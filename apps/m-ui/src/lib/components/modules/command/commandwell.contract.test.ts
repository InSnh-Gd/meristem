import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'CommandWell.svelte'),
  'utf8'
)

describe('CommandWell source contract', () => {
  it('keeps the four controlled rendering branches', () => {
    expect(source).toContain('{#if commandStateError}')
    expect(source).toContain('{:else if !commandState}')
    expect(source).toContain("{:else if commandState.state === 'disabled'}")
    expect(source).toContain('{:else if confirming}')
    expect(source).toContain('{:else}')
  })

  it('keeps explicit confirm/cancel/button test ids for behavioral coverage', () => {
    expect(source).toContain('data-testid="command-disabled-reason"')
    expect(source).toContain('data-testid="command-confirm-btn"')
    expect(source).toContain('data-testid="command-cancel-btn"')
    expect(source).toContain('data-testid="command-btn"')
  })

  it('keeps semantic token usage instead of raw color literals', () => {
    expect(source).toContain('var(--signal-warn)')
    expect(source).toContain('var(--signal-ok)')
    expect(source).toContain('var(--signal-info)')
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}/)
  })
})
