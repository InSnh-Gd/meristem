import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import CommandWell from '../../src/lib/components/modules/command/CommandWell.svelte'
import { createControlRoomCommandState, createOverviewFixture } from './_specs/fixtures'

describe('CommandWell behavior', () => {
  it('shows enabled state button', () => {
    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        selectedNode: createOverviewFixture().nodes[0],
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByTestId('command-btn').textContent).toContain('运行 noop 任务')
  })

  it('shows disabled reason as visible text', () => {
    render(CommandWell, {
      props: {
        commandState: {
          state: 'disabled',
          disabledReason: '节点不可达',
          command: createControlRoomCommandState().command
        },
        selectedNode: createOverviewFixture().nodes[0],
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByTestId('command-disabled-reason').textContent).toContain('节点不可达')
  })

  it('shows confirm state with confirm and cancel actions', () => {
    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        selectedNode: createOverviewFixture().nodes[0],
        confirming: true,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByTestId('command-confirm-btn')).toBeTruthy()
    expect(screen.getByTestId('command-cancel-btn')).toBeTruthy()
  })

  it('runs cancel path when cancel button is clicked', async () => {
    const onCancel = vi.fn()

    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        selectedNode: createOverviewFixture().nodes[0],
        confirming: true,
        onRequestConfirm: vi.fn(),
        onCancel,
        onConfirm: vi.fn()
      }
    })

    await fireEvent.click(screen.getByTestId('command-cancel-btn'))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
