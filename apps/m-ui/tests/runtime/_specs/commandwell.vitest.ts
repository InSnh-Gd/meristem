import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import CommandWell from '../../../src/lib/components/modules/command/CommandWell.svelte'
import { createControlRoomCommandState, createOverviewFixture } from './fixtures'

describe('CommandWell runtime behavior', () => {
  it('renders an enabled command label', () => {
    const node = createOverviewFixture().nodes[0]

    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        selectedNode: node,
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByTestId('command-btn').textContent).toContain('运行 noop 任务')
  })

  it('renders disabled reasons when the command is unavailable', () => {
    const node = createOverviewFixture().nodes[0]

    render(CommandWell, {
      props: {
        commandState: {
          state: 'disabled',
          disabledReason: '节点不可达',
          command: createControlRoomCommandState().command
        },
        selectedNode: node,
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByTestId('command-disabled-reason').textContent).toContain('节点不可达')
  })
})
