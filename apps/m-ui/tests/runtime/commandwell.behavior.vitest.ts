import { fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CommandWell from '../../src/lib/components/modules/command/CommandWell.svelte'
import {
  createControlRoomCommandState,
  createForcedRelayResultFixture,
  createOverviewFixture,
  createTaskResultFixture
} from './_specs/fixtures'

describe('CommandWell behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  it('respects prefers-reduced-motion without crashing or blocking interaction', async () => {
    // Mock matchMedia to simulate reduced motion preference
    const motionQueryMatches = true
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? motionQueryMatches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))

    const onRequestConfirm = vi.fn()

    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        selectedNode: createOverviewFixture().nodes[0],
        confirming: false,
        onRequestConfirm,
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    // Component renders safely with motion duration evaluated to 0
    const btn = screen.getByTestId('command-btn')
    expect(btn).toBeTruthy()

    await fireEvent.click(btn)
    expect(onRequestConfirm).toHaveBeenCalledTimes(1)
  })

  it('renders task result evidence inline after command execution', () => {
    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        selectedNode: createOverviewFixture().nodes[0],
        taskResult: createTaskResultFixture(),
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    const result = screen.getByLabelText('命令结果')
    expect(result.textContent).toContain('task.id')
    expect(result.textContent).toContain('task.status')
    expect(result.textContent).toContain('task-1')
    expect(result.textContent).toContain('queued')
    expect(result.textContent).toContain('decision-1')
    expect(result.textContent).toContain('corr-1')
  })

  it('renders execution failures inline without hiding the command action', () => {
    render(CommandWell, {
      props: {
        commandState: createControlRoomCommandState(),
        commandExecutionError: '操作执行失败 (policy_denied)',
        selectedNode: createOverviewFixture().nodes[0],
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    expect(screen.getByText('操作执行失败 (policy_denied)')).toBeTruthy()
    expect(screen.getByTestId('command-btn').textContent).toContain('运行 noop 任务')
  })

  it('renders forced relay evidence inline after command execution', () => {
    render(CommandWell, {
      props: {
        commandState: {
          state: 'enabled',
          command: {
            ...(createControlRoomCommandState().command ?? {
              id: 'task.submit.noop',
              label: '运行 noop 任务',
              action: 'task:submit',
              resource: 'node/leaf-1',
              risk: 'high',
              requiredPermissions: ['task:submit'],
              requiresPolicy: true,
              requiresAudit: true
            }),
            id: 'network.forced-relay.change.execute',
            label: '切换强制 Relay 类',
            action: 'network:profile-enable',
            resource: 'network/network-cn-001/node/leaf-1'
          }
        },
        selectedNode: createOverviewFixture().nodes[0],
        taskResult: createForcedRelayResultFixture(),
        confirming: false,
        onRequestConfirm: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn()
      }
    })

    const result = screen.getByLabelText('命令结果')
    expect(result.textContent).toContain('forced-tcp-relay')
    expect(result.textContent).toContain('audit-relay-1')
    expect(result.textContent).toContain('event-relay-1')
    expect(result.textContent).toContain('corr-relay-1')
  })
})
