import { render, screen } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'
import CommandWell from '../../src/lib/components/modules/command/CommandWell.svelte'
import InlineOperationalAlert from '../../src/lib/components/ui/InlineOperationalAlert.svelte'
import { createControlRoomCommandState, createOverviewFixture } from './_specs/fixtures'

describe('token presence and critical-state visibility', () => {
  it('renders InlineOperationalAlert with non-color-only message text', () => {
    render(InlineOperationalAlert, {
      props: {
        message: '依赖不可用：m-log',
        severity: 'warn'
      }
    })

    expect(screen.getByRole('alert').textContent).toContain('依赖不可用：m-log')
  })

  it('renders CommandWell disabled state with visible reason text', () => {
    render(CommandWell, {
      props: {
        commandState: {
          state: 'disabled',
          disabledReason: '缺少操作者令牌',
          command: createControlRoomCommandState().command
        },
        selectedNode: createOverviewFixture().nodes[0],
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByTestId('command-disabled-reason').textContent).toContain('缺少操作者令牌')
  })
})
