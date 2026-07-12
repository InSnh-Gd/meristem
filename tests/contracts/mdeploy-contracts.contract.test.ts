import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  decodeMDeployDesiredStateDocumentV01,
  encodeMDeployDesiredStateDocumentV01,
  MDeployAgentEnrollmentV01Schema,
  MDeployAgentHeartbeatV01Schema,
  MDeployApprovalV01Schema,
  MDeployDesiredStateDocumentV00Schema,
  type MDeployDesiredStateDocumentV01FromSchema,
  MDeployDesiredStateDocumentV01Schema,
  MDeployDriftReportV01Schema,
  MDeployEvidenceMetadataV01Schema,
  MDeployOpenTofuPlanApplyStatusV01Schema,
  MDeployProposalV01Schema,
  MDeployReconcileResultV01Schema,
  MDeployRollbackRequestV01Schema,
  MDeployRollbackResultV01Schema,
  MDeployRuntimeDriverSelectionV01Schema,
  MDeploySignedEnvelopeV01Schema,
  migrateMDeployDesiredStateDocumentV00ToV01
} from '../../packages/contracts/src/index.ts'

const digest = { algorithm: 'sha256', value: 'sha256:desired-state-001' } as const
const storageRef = {
  uri: 's3://meristem-evidence/apply-001.json',
  digest,
  redactionStatus: 'redacted'
} as const

function desiredState(): MDeployDesiredStateDocumentV01FromSchema {
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
    generatedAt: '2026-07-07T00:00:00.000Z'
  }
}

function assertRoundTrip(schema: Schema.Schema.AnyNoContext, value: unknown) {
  const decoded = Schema.decodeUnknownSync(schema)(value)
  const encoded = Schema.encodeSync(schema)(decoded)
  expect(Schema.decodeUnknownSync(schema)(encoded)).toEqual(decoded)
}

describe('M-Deploy versioned contracts', () => {
  it('round-trips desired-state document and signed envelope schemas', () => {
    const document = desiredState()
    const envelope = {
      schemaVersion: 'mdeploy.signed-envelope@0.1.0',
      payload: document,
      signature: { algorithm: 'ed25519', value: 'sig-ed25519-fixture', payloadDigest: digest },
      signer: { kind: 'mdeploy-controller', identity: 'm-deploy-controller' },
      issuedAt: '2026-07-07T00:00:00.000Z',
      expiresAt: '2026-07-07T00:15:00.000Z',
      verification: {
        verified: true,
        verifiedAt: '2026-07-07T00:00:01.000Z',
        verifier: 'm-deploy-controller'
      }
    }

    assertRoundTrip(MDeployDesiredStateDocumentV01Schema, document)
    assertRoundTrip(MDeploySignedEnvelopeV01Schema, envelope)
  })

  it('decodes and encodes desired-state through public helpers', () => {
    const decoded = decodeMDeployDesiredStateDocumentV01(desiredState())
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) throw new Error(decoded.error.message)

    const encoded = encodeMDeployDesiredStateDocumentV01(decoded.value)
    expect(encoded.ok).toBe(true)
  })

  it('accepts public plain config and secret-bearing config backed by secretRef', () => {
    const document = desiredState()
    const service = document.services[0]
    if (!service) throw new Error('expected service fixture')

    const decoded = Schema.decodeUnknownSync(MDeployDesiredStateDocumentV01Schema)({
      ...document,
      services: [
        {
          ...service,
          config: {
            PUBLIC_BASE_URL: { kind: 'plain', value: 'https://meristem.example' },
            databasePassword: {
              kind: 'secretRef',
              secretRef: {
                provider: 'vault-kv-v2',
                keyPath: 'secret/data/mdeploy/database',
                version: 2
              }
            }
          }
        }
      ]
    })

    expect(decoded.services[0]?.config.PUBLIC_BASE_URL).toEqual({
      kind: 'plain',
      value: 'https://meristem.example'
    })
    expect(decoded.services[0]?.config.databasePassword).toEqual({
      kind: 'secretRef',
      secretRef: { provider: 'vault-kv-v2', keyPath: 'secret/data/mdeploy/database', version: 2 }
    })
  })

  it('migrates the v0.0.0 desired-state pointer into v0.1.0 source metadata', () => {
    const legacy = Schema.decodeUnknownSync(MDeployDesiredStateDocumentV00Schema)({
      schemaVersion: 'mdeploy.desired-state@0.0.0',
      repositoryUrl: 'https://git.example/meristem/desired-state.git',
      branch: 'main',
      commit: '0123456789abcdef0123456789abcdef01234567',
      path: 'deploy/prod',
      digest: 'sha256:legacy',
      runtimeDriver: 'podman',
      services: desiredState().services,
      generatedAt: '2026-07-07T00:00:00.000Z'
    })

    const migrated = migrateMDeployDesiredStateDocumentV00ToV01(legacy)

    expect(migrated.schemaVersion).toBe('mdeploy.desired-state@0.1.0')
    expect(migrated.source.digest).toEqual({ algorithm: 'sha256', value: 'sha256:legacy' })
    expect(migrated.runtime.driver).toBe('podman')
    expect(Schema.decodeUnknownSync(MDeployDesiredStateDocumentV01Schema)(migrated)).toEqual(
      migrated
    )
  })

  it('round-trips proposal, approval, runtime, plan/apply, agent, drift, reconcile, rollback, and evidence contracts', () => {
    const proposal = {
      schemaVersion: 'mdeploy.proposal@0.1.0',
      proposalId: 'proposal-1',
      sourceRef: desiredState().source,
      diffSummary: { added: 1, changed: 2, removed: 0, summary: 'update m-ui image digest' },
      actor: 'operator',
      policyDecisionId: 'pd-1',
      approvalStatus: 'approved',
      createdAt: '2026-07-07T00:00:00.000Z',
      correlationId: 'corr-1'
    }
    const approval = {
      schemaVersion: 'mdeploy.approval@0.1.0',
      approvalId: 'approval-1',
      proposalId: 'proposal-1',
      approver: 'security-admin',
      timestamp: '2026-07-07T00:01:00.000Z',
      result: 'approve',
      policyDecisionId: 'pd-2',
      correlationId: 'corr-1'
    }
    const reconcile = {
      schemaVersion: 'mdeploy.reconcile-result@0.1.0',
      operationId: 'op-1',
      agentId: 'agent-1',
      desiredStateDigest: digest,
      applyStatus: 'succeeded',
      evidenceRefs: [storageRef],
      completedAt: '2026-07-07T00:05:00.000Z'
    }
    const rollback = {
      schemaVersion: 'mdeploy.rollback-result@0.1.0',
      operationId: 'rollback-1',
      previousDigest: { algorithm: 'sha256', value: 'sha256:bad' },
      restoredDigest: digest,
      status: 'succeeded',
      evidenceRefs: [storageRef],
      completedAt: '2026-07-07T00:06:00.000Z'
    }

    assertRoundTrip(MDeployProposalV01Schema, proposal)
    assertRoundTrip(MDeployApprovalV01Schema, approval)
    assertRoundTrip(MDeployRuntimeDriverSelectionV01Schema, {
      schemaVersion: 'mdeploy.runtime-driver-selection@0.1.0',
      runtimeClass: 'production',
      runtimeDriver: 'podman',
      unitManager: 'quadlet-systemd',
      iacDriver: 'opentofu',
      selectedAt: '2026-07-07T00:00:00.000Z',
      selectedBy: 'm-deploy-controller'
    })
    assertRoundTrip(MDeployOpenTofuPlanApplyStatusV01Schema, {
      schemaVersion: 'mdeploy.opentofu-status@0.1.0',
      operationId: 'op-1',
      planStatus: 'planned',
      applyStatus: 'succeeded',
      stateDigest: digest,
      checkedAt: '2026-07-07T00:04:00.000Z'
    })
    assertRoundTrip(MDeployAgentEnrollmentV01Schema, {
      schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
      agentId: 'agent-1',
      hostId: 'host-1',
      capabilities: [{ runtimeDriver: 'podman', version: '5.0.0', features: ['compose'] }],
      controllerTrust: {
        issuer: 'm-deploy-controller',
        audience: 'mdeploy-agent',
        publicKeyFingerprint: 'fp-controller',
        expiresAt: '2026-08-07T00:00:00.000Z'
      },
      enrolledAt: '2026-07-07T00:00:00.000Z'
    })
    assertRoundTrip(MDeployAgentHeartbeatV01Schema, {
      schemaVersion: 'mdeploy.agent-heartbeat@0.1.0',
      agentId: 'agent-1',
      timestamp: '2026-07-07T00:00:00.000Z',
      lastAppliedDigest: digest,
      driftStatus: 'none',
      health: 'healthy',
      connectionStatus: 'connected',
      runtimeDrivers: ['podman'],
      correlationId: 'corr-1'
    })
    assertRoundTrip(MDeployDriftReportV01Schema, {
      schemaVersion: 'mdeploy.drift-report@0.1.0',
      reportId: 'drift-1',
      agentId: 'agent-1',
      expectedState: { digest, source: 'git' },
      actualState: { digest: { algorithm: 'sha256', value: 'sha256:runtime' }, source: 'runtime' },
      driftType: 'runtime_state',
      severity: 'high',
      timestamp: '2026-07-07T00:00:00.000Z'
    })
    assertRoundTrip(MDeployReconcileResultV01Schema, reconcile)
    assertRoundTrip(MDeployRollbackRequestV01Schema, {
      schemaVersion: 'mdeploy.rollback-request@0.1.0',
      operationId: 'rollback-1',
      targetDigest: digest,
      actor: 'operator',
      policyDecisionId: 'pd-rollback',
      correlationId: 'corr-rollback',
      requestedAt: '2026-07-07T00:05:00.000Z'
    })
    assertRoundTrip(MDeployRollbackResultV01Schema, rollback)
    assertRoundTrip(MDeployEvidenceMetadataV01Schema, {
      schemaVersion: 'mdeploy.evidence-metadata@0.1.0',
      operationId: 'op-1',
      correlationId: 'corr-1',
      auditId: 'audit-1',
      evidenceType: 'runtime_apply',
      timestamp: '2026-07-07T00:05:00.000Z',
      storageRef
    })
  })
})
