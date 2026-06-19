import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/svelte'
import TraceLink from './TraceLink.svelte'

describe('TraceLink', () => {
  it('renders correlation evidence without fabricating navigation', () => {
    const { getByText, container } = render(TraceLink, {
      correlationId: 'test-trace-id-123'
    })
    
    // Check it's visible
    const element = getByText('test-trace-id-123')
    expect(element).toBeDefined()
    
    // Check it's not a link
    expect(element.tagName).not.toBe('A')
    expect(element.getAttribute('href')).toBeNull()
    
    // Check aria-label specifies evidence
    expect(element.getAttribute('aria-label')).toContain('追踪凭证')
    expect(element.getAttribute('aria-label')).toContain('test-trace-id-123')
    
    // Make sure no fake /trace/ hrefs are anywhere in the rendered component
    expect(container.innerHTML).not.toContain('/trace/')
  })
})