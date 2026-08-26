import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import type { NetworkRuntimeTruth } from '$lib/types.ts'
import NetworkRepairStageView from './NetworkRepairStageView.svelte'

type RepairAction = NetworkRuntimeTruth['repairActions'][number]
type RepairDisabledReasonCode = NonNullable<RepairAction['disabledReason']>['code']

const COMMAND_ID = 'network.forced-relay.change.execute'

/** 构造修复动作资格展示态，默认可执行且来源为策略。 */
function repairAction(overrides: Partial<RepairAction> = {}): RepairAction {
  return {
    commandId: COMMAND_ID,
    state: 'enabled',
    stateSource: { sourceType: 'policy', sourceId: 'm-policy:authorize' },
    ...overrides
  }
}

describe('NetworkRepairStageView seam', () => {
  it('renders enabled repair actions with their policy source badge', () => {
    render(NetworkRepairStageView, {
      props: { repairActions: [repairAction()] }
    })

    expect(screen.getByTestId('repair-list')).toBeTruthy()
    const row = screen.getByTestId(`repair-action-${COMMAND_ID}`)
    expect(row.textContent).toContain(COMMAND_ID)
    expect(row.textContent).toContain('可执行')
    expect(screen.getByText('策略')).toBeTruthy()
    expect(screen.queryByTestId(`repair-guidance-${COMMAND_ID}`)).toBeNull()
  })

  it('renders the empty placeholder when policy exposes no repair action', () => {
    render(NetworkRepairStageView, {
      props: { repairActions: [] }
    })

    expect(screen.queryByTestId('repair-list')).toBeNull()
    expect(screen.getByText('暂无可用修复命令。')).toBeTruthy()
  })

  it('translates each documented disabled reason code into concrete guidance', () => {
    const cases: ReadonlyArray<readonly [RepairDisabledReasonCode, string]> = [
      ['missing_permission', '缺少权限，无法发起修复命令'],
      ['migration_required', '需先完成 Profile 迁移后再执行修复'],
      ['missing_secret_provider', 'SecretProvider 不可用，凭证材料无法注入'],
      ['stale_jwks', 'JWKS 缓存已过期'],
      ['missing_signal_relay', 'Signal/Relay 端点不可达']
    ]

    for (const [code, expected] of cases) {
      const view = render(NetworkRepairStageView, {
        props: {
          repairActions: [
            repairAction({
              state: 'disabled',
              disabledReason: { code, message: 'fixture disabled message' }
            })
          ]
        }
      })

      const guidance = screen.getByTestId(`repair-guidance-${COMMAND_ID}`)
      expect(guidance.textContent).toContain(expected)
      view.unmount()
    }
  })

  it('appends the service-supplied message to the missing-permission guidance', () => {
    render(NetworkRepairStageView, {
      props: {
        repairActions: [
          repairAction({
            state: 'disabled',
            disabledReason: {
              code: 'missing_permission',
              message: '缺少权限：network:profile-enable',
              missingPermission: 'network:profile-enable'
            }
          })
        ]
      }
    })

    const guidance = screen.getByTestId(`repair-guidance-${COMMAND_ID}`)
    expect(guidance.textContent).toContain('缺少权限：network:profile-enable')
  })

  it('falls back to the service message for reason codes without dedicated guidance', () => {
    render(NetworkRepairStageView, {
      props: {
        repairActions: [
          repairAction({
            state: 'disabled',
            disabledReason: { code: 'target_missing', message: '目标节点不存在' }
          })
        ]
      }
    })

    expect(screen.getByTestId(`repair-guidance-${COMMAND_ID}`).textContent).toContain(
      '目标节点不存在'
    )
  })

  it('renders multiple repair actions with per-command testids', () => {
    render(NetworkRepairStageView, {
      props: {
        repairActions: [
          repairAction(),
          repairAction({
            commandId: 'network.profile.enable.execute',
            state: 'disabled',
            disabledReason: { code: 'stale_jwks', message: 'jwks is stale' }
          })
        ]
      }
    })

    expect(screen.getByTestId(`repair-action-${COMMAND_ID}`).textContent).toContain('可执行')
    const second = screen.getByTestId('repair-action-network.profile.enable.execute')
    expect(second.textContent).toContain('已禁用')
    expect(
      screen.getByTestId('repair-guidance-network.profile.enable.execute').textContent
    ).toContain('JWKS 缓存已过期')
  })
})
