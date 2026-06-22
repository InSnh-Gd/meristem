import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { createRawSnippet } from 'svelte'
import ConfirmActionDialog from './ConfirmActionDialog.svelte'

const triggerLabel = '打开确认对话框'

function renderWithTrigger(
  overrides: Partial<{
    title: string
    description: string
    cancelLabel: string
    confirmLabel: string
    disabledReason: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void | Promise<void>
  }> = {}
) {
  return render(ConfirmActionDialog, {
    title: 'Danger Zone',
    description: 'Are you sure?',
    cancelLabel: 'Cancel',
    confirmLabel: 'Confirm',
    onConfirm: vi.fn(),
    children: createRawSnippet(() => ({
      render: () => `<span>${triggerLabel}</span>`
    })),
    ...overrides
  })
}

describe('ConfirmActionDialog', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders accessible dialog correctly', () => {
    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: 'Are you sure?',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      onConfirm: vi.fn(),
      open: true
    })

    // role/accessible rendering
    const dialog = screen.getByRole('alertdialog', { name: 'Danger Zone' })
    expect(dialog).toBeTruthy()

    expect(screen.getByText('Danger Zone')).toBeTruthy()
    expect(screen.getByText('Are you sure?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy()
  })

  it('disables confirm button and shows missing title reason', async () => {
    const onConfirm = vi.fn()
    render(ConfirmActionDialog, {
      title: '  ',
      description: 'Valid description',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      onConfirm,
      open: true
    })

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
    expect(confirmBtn.hasAttribute('disabled')).toBe(true)

    expect(screen.getByRole('heading', { name: '缺少操作标题' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent?.trim()).toBe('缺少操作标题')

    await fireEvent.click(confirmBtn)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('closes on cancel path', async () => {
    const onOpenChange = vi.fn()
    const onConfirm = vi.fn()
    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: 'Are you sure?',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      onConfirm,
      open: true,
      onOpenChange
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('opens from a real trigger and moves focus inside the dialog', async () => {
    const onOpenChange = vi.fn()

    renderWithTrigger({ onOpenChange })

    const trigger = screen.getByRole('button', { name: triggerLabel })
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await fireEvent.click(trigger)

    const dialog = await screen.findByRole('alertdialog', { name: 'Danger Zone' })
    expect(onOpenChange).toHaveBeenCalledWith(true)

    await waitFor(() => {
      const activeElement = document.activeElement
      expect(activeElement instanceof HTMLElement && dialog.contains(activeElement)).toBe(true)
    })
  })

  it('restores focus to the trigger after escape closes the dialog', async () => {
    renderWithTrigger()

    const trigger = screen.getByRole('button', { name: triggerLabel })
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    await fireEvent.click(trigger)

    const dialog = await screen.findByRole('alertdialog', { name: 'Danger Zone' })

    await waitFor(() => {
      const activeElement = document.activeElement
      expect(activeElement instanceof HTMLElement && dialog.contains(activeElement)).toBe(true)
    })

    await fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })

    // happy-dom 当前能稳定保留 Bits UI 的 focus restore，因此这里直接证明触发器回焦。
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger)
    })
  })

  it('closes on Escape key', async () => {
    const onOpenChange = vi.fn()
    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: 'Are you sure?',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      onConfirm: vi.fn(),
      open: true,
      onOpenChange
    })

    const dialog = screen.getByRole('alertdialog')
    await fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('prevents double execution deterministically and shows pending disabled reason', async () => {
    let callCount = 0
    let resolveConfirm: () => void = () => {}
    const confirmPromise = new Promise<void>(resolve => {
      resolveConfirm = resolve
    })

    const onConfirm = vi.fn().mockImplementation(() => {
      callCount++
      return confirmPromise
    })

    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: 'Are you sure?',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      onConfirm,
      open: true
    })

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' })

    // Click multiple times rapidly
    await fireEvent.click(confirmBtn)
    await waitFor(() => {
      expect(confirmBtn.hasAttribute('disabled')).toBe(true)
      expect(cancelBtn.hasAttribute('disabled')).toBe(true)
      expect(screen.getByRole('alert').textContent?.trim()).toBe(
        '确认操作进行中，暂时无法取消或重复提交'
      )
    })
    await fireEvent.click(confirmBtn)
    await fireEvent.click(confirmBtn)

    // Verify it was only called once initially because it's waiting for promise
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(callCount).toBe(1)

    // resolve the promise
    resolveConfirm()

    // ensure even after resolve, it wasn't called more times during the wait
    await waitFor(() => {
      expect(callCount).toBe(1)
    })
  })

  it('disables confirm button and shows missing description reason', async () => {
    const onConfirm = vi.fn()
    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: '  ',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      onConfirm,
      open: true
    })

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
    expect(confirmBtn.hasAttribute('disabled')).toBe(true)

    expect(screen.getByRole('heading', { name: 'Danger Zone' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent?.trim()).toBe('缺少操作描述说明')

    await fireEvent.click(confirmBtn)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('disables confirm button and shows missing confirm label reason', async () => {
    const onConfirm = vi.fn()
    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: 'Valid description',
      cancelLabel: 'Cancel',
      confirmLabel: '  ',
      onConfirm,
      open: true
    })

    const confirmBtn = screen.getByRole('button', { name: '操作无效' })
    expect(confirmBtn.hasAttribute('disabled')).toBe(true)

    expect(screen.getByRole('alert').textContent?.trim()).toBe('缺少确认按钮文案')

    await fireEvent.click(confirmBtn)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows explicit disabledReason and prevents confirm', async () => {
    const onConfirm = vi.fn()
    render(ConfirmActionDialog, {
      title: 'Danger Zone',
      description: 'Valid description',
      cancelLabel: 'Cancel',
      confirmLabel: 'Confirm',
      disabledReason: '权限不足',
      onConfirm,
      open: true
    })

    const confirmBtn = screen.getByRole('button', { name: 'Confirm' })
    expect(confirmBtn.hasAttribute('disabled')).toBe(true)

    expect(screen.getByRole('alert').textContent?.trim()).toBe('权限不足')

    await fireEvent.click(confirmBtn)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
