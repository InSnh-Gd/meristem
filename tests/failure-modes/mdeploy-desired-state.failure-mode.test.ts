import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  MDeployDesiredStateDocumentV01Schema,
  deriveMDeployAgentConnectionStatus,
  validateMDeploySignedEnvelopeForApply,
  type MDeployDesiredStateDocumentV01FromSchema,
  type MDeploySignedEnvelopeV01FromSchema
} from '../../packages/contracts/src/index.ts'

const digest = { algorithm: 'sha256', value: 'sha256:desired-state-001' } as const
const applyContext = {
  now: '2026-07-07T00:05:00.000Z',
  expectedRuntimeDriver: 'podman',
  snapshotTtlMs: 15 * 60 * 1000
} as const

function desiredState(overrides?: Partial<MDeployDesiredStateDocumentV01FromSchema>) {
  return {
    schemaVersion: 'mdeploy.desired-state@0.1.0',
    source: {
      repositoryUrl: 'https://git.example/meristem/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/prod',
      digest,
      syncedAt: '2026-07-07T00:00:00.000Z'
    },
    runtime: { driver: 'podman', iacDriver: 'opentofu', targetScope: ['prod'] },
    topology: {
      topologyId: 'prod-vm-topology',
      revision: 'topology-1',
      nodes: [{ nodeId: 'node-1', hostId: 'host-1', role: 'worker', runtimeDriver: 'podman' }]
    },
    services: [
      {
        serviceId: 'm-ui',
        image: { image: 'registry.example/meristem/m-ui', digest, humanTag: 'prod' },
        config: {
          PUBLIC_BASE_URL: { kind: 'plain', value: 'https://meristem.example' },
          OIDC_CLIENT_SECRET: {
            kind: 'secretRef',
            secretRef: { provider: 'vault-kv-v2', keyPath: 'secret/data/mdeploy/oidc', version: 1 }
          }
        },
        secretRefs: [{ provider: 'vault-kv-v2', keyPath: 'secret/data/mdeploy/oidc', version: 1 }]
      }
    ],
    generatedAt: '2026-07-07T00:00:00.000Z',
    ...overrides
  } satisfies MDeployDesiredStateDocumentV01FromSchema
}

function signedEnvelope(
  overrides?: Partial<MDeploySignedEnvelopeV01FromSchema>
): MDeploySignedEnvelopeV01FromSchema {
  return {
    schemaVersion: 'mdeploy.signed-envelope@0.1.0',
    payload: desiredState(),
    signature: { algorithm: 'ed25519', value: 'sig-ed25519-fixture', payloadDigest: digest },
    signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
    issuedAt: '2026-07-07T00:00:00.000Z',
    expiresAt: '2026-07-07T00:15:00.000Z',
    verification: {
      verified: true,
      verifiedAt: '2026-07-07T00:00:01.000Z',
      verifier: 'm-deploy-controller'
    },
    ...overrides
  }
}

describe('M-Deploy desired-state failure modes', () => {
  it('rejects unsigned desired-state before runtime action', () => {
    const result = validateMDeploySignedEnvelopeForApply(desiredState(), applyContext)

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected unsigned desired-state to fail')
    expect(result.error.code).toBe('unsigned_desired_state')
  })

  it('rejects tampered desired-state with signature verification failure', () => {
    const result = validateMDeploySignedEnvelopeForApply(
      signedEnvelope({
        payload: desiredState({
          source: {
            ...desiredState().source,
            digest: { algorithm: 'sha256', value: 'sha256:tampered' }
          }
        })
      }),
      applyContext
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected tampered desired-state to fail')
    expect(result.error.code).toBe('signature_verification_failed')
    expect(result.error.detail).toBe('digest_mismatch')
  })

  it('rejects stale desired-state beyond TTL', () => {
    const result = validateMDeploySignedEnvelopeForApply(
      signedEnvelope({
        issuedAt: '2026-07-06T23:00:00.000Z',
        expiresAt: '2026-07-06T23:15:00.000Z'
      }),
      applyContext
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected stale desired-state to fail')
    expect(result.error.code).toBe('stale_desired_state')
  })

  it('rejects secret values in desired-state schema validation', () => {
    const baseService = desiredState().services[0]
    if (!baseService) throw new Error('expected service fixture')
    const unsafe = desiredState({
      services: [
        {
          ...baseService,
          config: {
            PUBLIC_BASE_URL: { kind: 'plain', value: 'https://meristem.example' },
            databasePassword: { kind: 'plain', value: 'plaintext-secret' }
          }
        }
      ]
    })

    expect(() => Schema.decodeUnknownSync(MDeployDesiredStateDocumentV01Schema)(unsafe)).toThrow()
  })

  it('rejects case-insensitive secret-bearing config key forms', () => {
    const baseService = desiredState().services[0]
    if (!baseService) throw new Error('expected service fixture')

    for (const key of [
      'PASSWORD',
      'DATABASEPASSWORD',
      'accessToken',
      'client_secret',
      'signing-key',
      'databaseCredential'
    ]) {
      const unsafe = desiredState({
        services: [
          {
            ...baseService,
            config: { [key]: { kind: 'plain', value: 'plaintext-secret' } }
          }
        ]
      })

      expect(() => Schema.decodeUnknownSync(MDeployDesiredStateDocumentV01Schema)(unsafe)).toThrow()
    }
  })

  it('rejects plaintext secret-like keys in nested desired-state configuration', () => {
    const baseService = desiredState().services[0]
    if (!baseService) throw new Error('expected service fixture')
    const unsafe = desiredState({
      services: [
        {
          ...baseService,
          config: {
            databasePassword: {
              kind: 'secretRef',
              secretRef: {
                provider: 'vault-kv-v2',
                keyPath: 'secret/data/mdeploy/database',
                metadata: { nestedCredential: 'plaintext-secret' }
              }
            }
          }
        }
      ]
    })

    expect(() => Schema.decodeUnknownSync(MDeployDesiredStateDocumentV01Schema)(unsafe)).toThrow()
  })

  it('returns typed mismatch error for wrong runtime driver', () => {
    const result = validateMDeploySignedEnvelopeForApply(
      signedEnvelope({
        payload: desiredState({
          runtime: { driver: 'docker', iacDriver: 'opentofu', targetScope: ['prod'] }
        })
      }),
      applyContext
    )

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected runtime mismatch to fail')
    expect(result.error.code).toBe('runtime_driver_mismatch')
  })

  it('records disconnected status when agent heartbeat is stale', () => {
    const status = deriveMDeployAgentConnectionStatus(
      {
        schemaVersion: 'mdeploy.agent-heartbeat@0.1.0',
        agentId: 'agent-1',
        timestamp: '2026-07-07T00:00:00.000Z',
        lastAppliedDigest: digest,
        driftStatus: 'none',
        health: 'healthy',
        connectionStatus: 'connected',
        runtimeDrivers: ['podman'],
        correlationId: 'corr-1'
      },
      '2026-07-07T00:31:00.000Z',
      30 * 60 * 1000
    )

    expect(status).toBe('disconnected')
  })
})
