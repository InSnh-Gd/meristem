import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'

import BreakGlassWorkspace from './BreakGlassWorkspace.svelte'
import { appState } from '$lib/stores.svelte.ts'
import { installAppStateReset } from '../../../../../tests/runtime/_specs/app-state'
import { createBreakGlassCommandState } from '../../../../../tests/runtime/_specs/fixtures'

installAppStateReset()

describe('BreakGlassWorkspace seam', () => {
  it('renders risk warning and command region correctly', () => {
    appState.commandState = createBreakGlassCommandState()

    render(BreakGlassWorkspace)

    expect(document.title).toContain('紧急预案 (Break-glass) | Meristem')
    expect(screen.getByText('⚠ 警告：破坏性操作')).toBeTruthy()
    expect(screen.getByRole('button', { name: '验证紧急操作资格' })).toBeTruthy()
    expect(screen.getByText('请在面板中验证紧急操作')).toBeTruthy()
  })
})
