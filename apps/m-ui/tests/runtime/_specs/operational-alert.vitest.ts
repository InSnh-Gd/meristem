import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import InlineOperationalAlert from '../../../src/lib/components/ui/InlineOperationalAlert.svelte'

describe('InlineOperationalAlert runtime behavior', () => {
  it('renders a visible operational alert when configured', () => {
    render(InlineOperationalAlert, {
      props: {
        message: '依赖不可用：m-log',
        severity: 'warn'
      }
    })

    expect(screen.getByRole('alert').textContent).toContain('依赖不可用：m-log')
  })
})
