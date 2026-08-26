import { render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import type { NetworkRuntimeTruth } from '$lib/types.ts'
import NetworkRuntimeObservationView from './NetworkRuntimeObservationView.svelte'

type NetbirdProcess = NetworkRuntimeTruth['netbirdProcess']
type PacketProof = NetworkRuntimeTruth['packetProof']
type SecretProvider = NetworkRuntimeTruth['secretProvider']

/** 构造 NetBird 进程对照态，默认 desired/observed 一致且健康。 */
function netbirdProcess(overrides: Partial<NetbirdProcess> = {}): NetbirdProcess {
  return {
    desired: 'running',
    observed: 'running',
    status: 'healthy',
    summary: 'NetBird process is running and healthy',
    nodes: [
      {
        nodeId: 'stem-direct-001',
        desired: 'running',
        observed: 'running',
        status: 'healthy',
        detail: 'NetBird is running on stem'
      }
    ],
    stateSource: { sourceType: 'read-model', sourceId: 'mnet:netbird-process' },
    ...overrides
  }
}

/** 构造数据包可达性证明结果。 */
function packetProof(overrides: Partial<PacketProof> = {}): PacketProof {
  return {
    status: 'success',
    summary: 'packet reachability proof succeeded',
    source: 'stem-direct-001',
    target: 'leaf-direct-001',
    probe: 'tcp',
    targetOverlayIp: '100.64.0.7',
    stateSource: { sourceType: 'read-model', sourceId: 'mnet:packet-proof' },
    ...overrides
  }
}

/** 构造 SecretProvider 状态。 */
function secretProvider(overrides: Partial<SecretProvider> = {}): SecretProvider {
  return {
    status: 'resolved',
    summary: 'secret provider resolved',
    stateSource: { sourceType: 'authoritative', sourceId: 'mnet:secrets' },
    ...overrides
  }
}

describe('NetworkRuntimeObservationView seam', () => {
  it('renders desired/observed NetBird truth with a per-node comparison table', () => {
    render(NetworkRuntimeObservationView, {
      props: {
        netbirdProcess: netbirdProcess(),
        packetProof: packetProof(),
        secretProvider: secretProvider()
      }
    })

    expect(screen.getByTestId('observe-grid')).toBeTruthy()

    const card = screen.getByTestId('observe-netbird-process')
    expect(card.textContent).toContain('NetBird 进程状态')
    expect(card.textContent).toContain('期望态 (desired)')
    expect(card.textContent).toContain('观测态 (observed)')
    expect(card.textContent).toContain('运行中')
    expect(card.textContent).toContain('健康')

    const row = screen.getByTestId('netbird-process-node-stem-direct-001')
    expect(row.textContent).toContain('stem-direct-001')
    expect(row.textContent).toContain('NetBird is running on stem')
  })

  it('renders degraded NetBird state as text rather than color alone', () => {
    render(NetworkRuntimeObservationView, {
      props: {
        netbirdProcess: netbirdProcess({
          desired: 'running',
          observed: 'stopped',
          status: 'degraded',
          summary: 'NetBird stopped unexpectedly',
          nodes: [
            {
              nodeId: 'leaf-direct-001',
              desired: 'running',
              observed: 'not-run',
              status: 'degraded',
              detail: 'sidecar never started'
            }
          ]
        }),
        packetProof: packetProof(),
        secretProvider: secretProvider()
      }
    })

    const card = screen.getByTestId('observe-netbird-process')
    expect(card.textContent).toContain('已停止')
    expect(card.textContent).toContain('已降级')

    const row = screen.getByTestId('netbird-process-node-leaf-direct-001')
    expect(row.textContent).toContain('未运行')
    expect(row.textContent).toContain('sidecar never started')
  })

  it('renders reachable and unreachable packet proof outcomes', () => {
    const reachable = render(NetworkRuntimeObservationView, {
      props: {
        netbirdProcess: netbirdProcess(),
        packetProof: packetProof(),
        secretProvider: secretProvider()
      }
    })

    const successCard = screen.getByTestId('observe-packet-proof')
    expect(successCard.textContent).toContain('可达')
    expect(successCard.textContent).toContain('100.64.0.7')
    expect(successCard.textContent).toContain('探测类型')
    reachable.unmount()

    render(NetworkRuntimeObservationView, {
      props: {
        netbirdProcess: netbirdProcess(),
        packetProof: packetProof({
          status: 'failure',
          summary: 'no packet reached the target',
          probe: undefined,
          targetOverlayIp: undefined
        }),
        secretProvider: secretProvider()
      }
    })

    const failureCard = screen.getByTestId('observe-packet-proof')
    expect(failureCard.textContent).toContain('不可达')
    expect(failureCard.textContent).not.toContain('探测类型')
    expect(failureCard.textContent).not.toContain('目标 Overlay IP')
  })

  it('renders each SecretProvider status label', () => {
    const cases: ReadonlyArray<readonly [SecretProvider['status'], string]> = [
      ['resolved', '已就绪'],
      ['missing', '凭证缺失'],
      ['denied', '访问被拒']
    ]

    for (const [status, expected] of cases) {
      const view = render(NetworkRuntimeObservationView, {
        props: {
          netbirdProcess: netbirdProcess(),
          packetProof: packetProof(),
          secretProvider: secretProvider({ status })
        }
      })

      expect(screen.getByTestId('observe-secret-provider').textContent).toContain(expected)
      view.unmount()
    }
  })

  it('falls back to unknown labels and read-model badges when runtime truth is absent', () => {
    render(NetworkRuntimeObservationView, {
      props: {
        netbirdProcess: null,
        packetProof: null,
        secretProvider: null
      }
    })

    const card = screen.getByTestId('observe-netbird-process')
    expect(card.textContent).toContain('未知')
    expect(card.textContent).toContain('—')
    expect(screen.getByTestId('observe-packet-proof').textContent).toContain('未执行')
    expect(screen.getByTestId('observe-secret-provider').textContent).toContain('unknown')
    // 缺失 stateSource 时回退为读模型徽标，关键状态仍保持可溯源标注。
    expect(screen.getAllByText('读模型').length).toBe(3)
  })
})
