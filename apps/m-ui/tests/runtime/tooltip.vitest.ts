import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import TooltipTestWrapper from './fixtures/TooltipTestWrapper.svelte'

// Tooltip event targets land on the wrapper the test harness mounts the
// trigger into; if the wrapper ever disappears the test must fail loudly
// rather than silently dispatch into `null`.
function requireParent(trigger: HTMLElement): HTMLElement {
  const parent = trigger.parentElement
  if (!parent) {
    throw new Error('Tooltip trigger has no parentElement wrapper')
  }
  return parent
}

describe('Tooltip Quality Gates', () => {
  it('renders trigger and shows tooltip on hover (Happy path / Gate 7)', async () => {
    render(TooltipTestWrapper, {
      content: 'This is the tooltip content',
      triggerText: 'Hover me'
    })

    const trigger = screen.getByText('Hover me')
    const wrapper = requireParent(trigger)
    expect(trigger).toBeTruthy()
    expect(screen.queryByText('This is the tooltip content')).toBeNull()

    await fireEvent.pointerEnter(wrapper)
    await fireEvent.mouseEnter(wrapper)

    await waitFor(() => {
      expect(screen.queryByText('This is the tooltip content')).toBeTruthy()
    }, { timeout: 1000 })
  })

  it('is accessible via keyboard (Gate 2)', async () => {
    render(TooltipTestWrapper, {
      content: 'Keyboard tooltip',
      triggerText: 'Focus me'
    })

    const trigger = screen.getByText('Focus me')
    const wrapper = requireParent(trigger)
    expect(screen.queryByText('Keyboard tooltip')).toBeNull()

    await fireEvent.focus(wrapper)

    await waitFor(() => {
      expect(screen.queryByText('Keyboard tooltip')).toBeTruthy()
    }, { timeout: 1000 })

    await fireEvent.blur(wrapper)

    await waitFor(() => {
      expect(screen.queryByText('Keyboard tooltip')).toBeNull()
    }, { timeout: 1000 })
  })

  it('renders appropriate ARIA attributes (Gate 2)', async () => {
    render(TooltipTestWrapper, {
      content: 'ARIA content',
      triggerText: 'ARIA trigger'
    })

    const trigger = screen.getByText('ARIA trigger')
    const wrapper = requireParent(trigger)
    await fireEvent.pointerEnter(wrapper)

    await waitFor(() => {
      const tooltip = screen.queryByText('ARIA content')
      expect(tooltip).toBeTruthy()
      if (tooltip) {
        expect(tooltip.getAttribute('role')).toBe('tooltip')
      }
    }, { timeout: 1000 })
  })
})
