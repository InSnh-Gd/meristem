import { describe, expect, it } from 'bun:test'

const SENTINELS = {
  privateKey: 'TASK20_PRIVATE_KEY_DO_NOT_LEAK',
  runtimeToken: 'TASK20_RUNTIME_TOKEN_DO_NOT_LEAK',
  acmeSecret: 'TASK20_ACME_SECRET_DO_NOT_LEAK',
  sidecarSecret: 'TASK20_SIDECAR_SECRET_DO_NOT_LEAK'
} as const

const FORBIDDEN_PATTERNS = [
  /privateKey/i,
  /wireguardPrivateKey/i,
  /-----BEGIN/i,
  /PRIVATE KEY/i,
  /runtimeToken/i,
  /nodeToken/i,
  /acmeAccountKey/i,
  /acmeChallengeSecret/i,
  /sidecarSecret/i,
  /sidecarCredential/i
]

type Fixture = {
  readonly name: string
  readonly surface: 'event' | 'log' | 'ui'
  readonly payload: unknown
}

function stringify(payload: unknown): string {
  return JSON.stringify(payload)
}

/**
 * 统一扫描新增加的事件、日志和 UI fixture，确保字符串和值都不包含私钥或 token 类材料。
 */
function assertRedacted(fixture: Fixture): void {
  const text = stringify(fixture.payload)
  expect(text).not.toContain(SENTINELS.privateKey)
  expect(text).not.toContain(SENTINELS.runtimeToken)
  expect(text).not.toContain(SENTINELS.acmeSecret)
  expect(text).not.toContain(SENTINELS.sidecarSecret)

  for (const pattern of FORBIDDEN_PATTERNS) {
    expect(text, `${fixture.surface}:${fixture.name} leaked ${pattern}`).not.toMatch(pattern)
  }
}

describe('M-Net data-plane redaction scanner', () => {
  it('scans all new event, log, and UI fixtures for private material', () => {
    const fixtures: readonly Fixture[] = [
      {
        name: 'event.network-map-published',
        surface: 'event',
        payload: {
          subject: 'mnet.network_map.published.v0',
          payload: {
            networkId: 'network-hardening',
            mapVersion: 7,
            profileVersion: 'm-net-cn@0.2.0',
            relayAssignment: {
              relayType: 'wstunnel',
              relayEndpoint: 'wss://relay.example',
              nodeIds: ['stem-a', 'leaf-a']
            },
            redactedSecrets: ['secretRef:mnet-cn-headscale-endpoint']
          }
        }
      },
      {
        name: 'log.audit-expired-ticket',
        surface: 'log',
        payload: {
          level: 'warn',
          message: 'join ticket redemption rejected',
          code: 'node.join_ticket_expired',
          audit: {
            action: 'mnet.clock_skew.rejected',
            result: 'rejected',
            ticketId: 'ticket-001'
          }
        }
      },
      {
        name: 'log.sidecar-crash-report',
        surface: 'log',
        payload: {
          level: 'error',
          message: 'sidecar crash observed',
          code: 'sidecar.crashed',
          payload: {
            unit: 'meristem-wstunnel.service',
            restartCount: 3,
            stderrSummary: 'relay exited unexpectedly'
          }
        }
      },
      {
        name: 'ui.relay-unavailable-envelope',
        surface: 'ui',
        payload: {
          error: {
            code: 'relay.unavailable',
            message: 'wstunnel relay is unavailable',
            fallback: 'direct',
            safeFields: {
              relayEndpoint: 'wss://relay.example',
              networkId: 'network-hardening'
            }
          }
        }
      },
      {
        name: 'ui.acme-failure-envelope',
        surface: 'ui',
        payload: {
          error: {
            code: 'acme.directory_unavailable',
            message: 'ACME directory is unreachable',
            safeFields: {
              directoryUrl: 'https://acme.example/directory',
              fallbackMode: 'local-dev'
            }
          }
        }
      }
    ]

    fixtures.forEach(assertRedacted)
    expect(fixtures).toHaveLength(5)
  })
})
