import { render, screen, waitFor } from '@testing-library/svelte'
import { describe, expect, it, vi } from 'vitest'

vi.mock('$lib/bff.ts', () => ({
  fetchGlobalDefaults: vi.fn(async () => {
    throw new Error('global defaults offline')
  }),
  fetchMigrationStatus: vi.fn(async () => ({
    operationId: 'never-called',
    stateSource: { sourceType: 'authoritative', sourceId: 'fixture' }
  })),
  formatBffError: vi.fn((error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.length > 0) {
      return `${fallback}: ${error.message}`
    }

    return fallback
  })
}))

import GlobalProfileControls from '../../src/lib/components/modules/network/GlobalProfileControls.svelte'
import { appState } from '../../src/lib/stores.svelte.ts'
import { installAppStateReset } from './_specs/app-state'

installAppStateReset()

describe('degraded BFF behavior', () => {
  it('shows InlineOperationalAlert when global defaults loading fails', async () => {
    appState.token = 'fixture-token'

    render(GlobalProfileControls, {
      props: {
        profileVersion: 'm-net-cn@0.1.0'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('全局 Profile 控制状态加载失败: global defaults offline')).toBeTruthy()
    })

    expect(screen.getByText('演示界面只展示控制命令，未启用前端执行。')).toBeTruthy()
  })
})
