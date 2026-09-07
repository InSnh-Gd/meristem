import { Value } from '@sinclair/typebox/value'
import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  deployAgentsResponseSchema,
  deployApplyResponseSchema,
  deployApprovalResponseSchema,
  deployDesiredStateResponseSchema,
  deployDriftCheckResponseSchema,
  deployDriftResponseSchema,
  deployEvidenceResponseSchema,
  deployProposalResponseSchema,
  deployRollbackResponseSchema,
  MDeployAgentsResponseSchema,
  MDeployApplyOperationResponseSchema,
  MDeployApprovalResponseSchema,
  MDeployDesiredStateSummaryV01Schema,
  MDeployDriftCheckResponseSchema,
  MDeployDriftResponseSchema,
  MDeployEvidenceResponseSchema,
  MDeployProposalResponseSchema,
  MDeployRollbackOperationResponseSchema
} from '../../packages/contracts/src/index.ts'

const iso = '2026-07-01T00:00:00.000Z'
const digest = { algorithm: 'sha256', value: 'ab'.repeat(32) }
const commit = '0123456789abcdef0123456789abcdef01234567'

const sourceRef = {
  repositoryUrl: 'https://git.example.com/org/meristem.git',
  branch: 'refs/heads/main',
  commit,
  path: 'deploy/production',
  digest,
  syncedAt: iso
}

const desiredState = {
  latestDigest: digest,
  lastSuccessfulDigest: digest,
  syncedAt: iso,
  stale: false,
  controllerAvailable: true
}

const proposal = {
  schemaVersion: 'mdeploy.proposal@0.1.0',
  proposalId: 'prop-1',
  sourceRef,
  diffSummary: { added: 1, changed: 0, removed: 0, summary: 'bump core' },
  actor: 'admin',
  policyDecisionId: 'pd-1',
  approvalStatus: 'pending',
  createdAt: iso,
  correlationId: 'corr-1'
}

const approval = {
  schemaVersion: 'mdeploy.approval@0.1.0',
  approvalId: 'approval-1',
  proposalId: 'prop-1',
  approver: 'security-admin',
  timestamp: iso,
  result: 'approve',
  policyDecisionId: 'pd-2',
  correlationId: 'corr-2'
}

const operation = {
  operationId: 'op-1',
  kind: 'apply',
  proposalId: 'prop-1',
  agentId: 'agent-1',
  envelope: { payload: {} },
  desiredStateDigest: digest,
  actor: 'security-admin',
  policyDecisionId: 'pd-3',
  quorumProofId: 'qp-1',
  auditId: 'audit-1',
  correlationId: 'corr-3',
  status: 'queued',
  publicationStatus: 'pending',
  createdAt: iso,
  previousDigest: digest,
  completedAt: iso
}

const driftReport = {
  schemaVersion: 'mdeploy.drift-report@0.1.0',
  reportId: 'report-1',
  agentId: 'agent-1',
  expectedState: { digest, source: 'git' },
  actualState: { digest, source: 'runtime' },
  driftType: 'runtime_state',
  severity: 'high',
  timestamp: iso,
  resolvedAt: iso
}

const evidence = {
  schemaVersion: 'mdeploy.evidence-metadata@0.1.0',
  operationId: 'op-1',
  correlationId: 'corr-4',
  auditId: 'audit-1',
  evidenceType: 'agent_ack',
  timestamp: iso,
  storageRef: { uri: 's3://evidence/op-1', digest, redactionStatus: 'redacted' }
}

const agentRecord = {
  enrollment: {
    schemaVersion: 'mdeploy.agent-enrollment@0.1.0',
    agentId: 'agent-1',
    hostId: 'host-1',
    capabilities: [{ runtimeDriver: 'podman', version: '5.0', features: ['quadlet-systemd'] }],
    controllerTrust: {
      issuer: 'meristem-controller',
      audience: 'm-deploy-agent',
      publicKeyFingerprint: 'fingerprint-1',
      expiresAt: iso
    },
    enrolledAt: iso
  },
  heartbeat: {
    schemaVersion: 'mdeploy.agent-heartbeat@0.1.0',
    agentId: 'agent-1',
    timestamp: iso,
    lastAppliedDigest: digest,
    driftStatus: 'none',
    health: 'healthy',
    connectionStatus: 'connected',
    runtimeDrivers: ['podman'],
    correlationId: 'corr-5'
  }
}

type Corruption = { name: string; mutate: (value: Record<string, unknown>) => Record<string, unknown> }

type AnyEffectSchema = Schema.Codec<unknown>

/** 断言 TypeBox 与 Effect 对同一份输入给出相同的接受/拒绝结论，锁死两侧 schema 不漂移。 */
function checkParity<TSchema extends Schema.Codec<unknown>>(
  name: string,
  effectSchema: TSchema,
  typeboxSchema: Parameters<typeof Value.Check>[0],
  valid: unknown,
  corruptions: readonly Corruption[]
) {
  const decodeSchema = effectSchema as unknown as AnyEffectSchema
  describe(`schema parity: ${name}`, () => {
    it('accepts the canonical fixture in both layers', () => {
      expect(() => Schema.decodeUnknownSync(decodeSchema)(valid)).not.toThrow()
      expect(Value.Check(typeboxSchema, valid)).toBe(true)
    })

    for (const corruption of corruptions) {
      it(`rejects ${corruption.name} in both layers`, () => {
        const mutated = corruption.mutate(structuredClone(valid) as Record<string, unknown>)
        expect(() => Schema.decodeUnknownSync(decodeSchema)(mutated)).toThrow()
        expect(Value.Check(typeboxSchema, mutated)).toBe(false)
      })
    }
  })
}

type PathSegment = string | number

function walkToParent(clone: Record<string, unknown>, path: readonly PathSegment[]): Record<string, unknown> {
  let node: Record<string, unknown> = clone
  for (let index = 0; index < path.length - 1; index++) {
    const segment = path[index]
    if (segment === undefined) throw new Error('invalid corruption path')
    node = node[segment] as Record<string, unknown>
  }
  return node
}

const setAt =
  (path: readonly PathSegment[], value: unknown): Corruption['mutate'] =>
  clone => {
    const parent = walkToParent(clone, path)
    const last = path[path.length - 1]
    if (last === undefined) throw new Error('corruption path must not be empty')
    parent[last] = value
    return clone
  }

const deleteAt =
  (path: readonly PathSegment[]): Corruption['mutate'] =>
  clone => {
    const parent = walkToParent(clone, path)
    const last = path[path.length - 1]
    if (last === undefined) throw new Error('corruption path must not be empty')
    delete parent[last]
    return clone
  }

checkParity('desired-state', MDeployDesiredStateSummaryV01Schema, deployDesiredStateResponseSchema, desiredState, [
  { name: 'digest algorithm invalid', mutate: setAt(['latestDigest', 'algorithm'], 'md5') },
  { name: 'stale wrong type', mutate: setAt(['stale'], 'yes') },
  { name: 'required controllerAvailable missing', mutate: deleteAt(['controllerAvailable']) }
])

checkParity('proposal', MDeployProposalResponseSchema, deployProposalResponseSchema, { proposal }, [
  { name: 'approvalStatus invalid literal', mutate: setAt(['proposal', 'approvalStatus'], 'bogus') },
  { name: 'schemaVersion invalid', mutate: setAt(['proposal', 'schemaVersion'], 'mdeploy.proposal@9.9.9') },
  { name: 'sourceRef digest algorithm invalid', mutate: setAt(['proposal', 'sourceRef', 'digest', 'algorithm'], 'md5') },
  { name: 'required correlationId missing', mutate: deleteAt(['proposal', 'correlationId']) },
  { name: 'required policyDecisionId missing', mutate: deleteAt(['proposal', 'policyDecisionId']) }
])

checkParity('approval', MDeployApprovalResponseSchema, deployApprovalResponseSchema, { approval }, [
  { name: 'result invalid literal', mutate: setAt(['approval', 'result'], 'bogus') },
  { name: 'required approver missing', mutate: deleteAt(['approval', 'approver']) }
])

const applyResponse = { operation: { ...operation, applyStatus: 'queued' } }
checkParity('apply', MDeployApplyOperationResponseSchema, deployApplyResponseSchema, applyResponse, [
  { name: 'kind invalid literal', mutate: setAt(['operation', 'kind'], 'bogus') },
  { name: 'status invalid literal', mutate: setAt(['operation', 'status'], 'bogus') },
  { name: 'publicationStatus invalid literal', mutate: setAt(['operation', 'publicationStatus'], 'bogus') },
  { name: 'applyStatus invalid literal', mutate: setAt(['operation', 'applyStatus'], 'bogus') },
  { name: 'required auditId missing', mutate: deleteAt(['operation', 'auditId']) }
])

const rollbackResponse = { operation: { ...operation, kind: 'rollback' } }
checkParity(
  'rollback',
  MDeployRollbackOperationResponseSchema,
  deployRollbackResponseSchema,
  rollbackResponse,
  [{ name: 'required agentId missing', mutate: deleteAt(['operation', 'agentId']) }]
)

checkParity('drift', MDeployDriftResponseSchema, deployDriftResponseSchema, { reports: [driftReport] }, [
  { name: 'driftType invalid literal', mutate: setAt(['reports', 0, 'driftType'], 'bogus') },
  { name: 'severity invalid literal', mutate: setAt(['reports', 0, 'severity'], 'bogus') },
  { name: 'expectedState source invalid', mutate: setAt(['reports', 0, 'expectedState', 'source'], 'bogus') },
  { name: 'required reportId missing', mutate: deleteAt(['reports', 0, 'reportId']) }
])

checkParity(
  'drift-check',
  MDeployDriftCheckResponseSchema,
  deployDriftCheckResponseSchema,
  { requested: true, correlationId: 'corr-1' },
  [{ name: 'requested not true', mutate: setAt(['requested'], false) }]
)

checkParity('evidence', MDeployEvidenceResponseSchema, deployEvidenceResponseSchema, { evidence: [evidence] }, [
  { name: 'evidenceType invalid literal', mutate: setAt(['evidence', 0, 'evidenceType'], 'bogus') },
  { name: 'redactionStatus invalid literal', mutate: setAt(['evidence', 0, 'storageRef', 'redactionStatus'], 'bogus') },
  { name: 'required operationId missing', mutate: deleteAt(['evidence', 0, 'operationId']) }
])

checkParity('agents', MDeployAgentsResponseSchema, deployAgentsResponseSchema, { agents: [agentRecord] }, [
  { name: 'runtimeDriver invalid literal', mutate: setAt(['agents', 0, 'enrollment', 'capabilities', 0, 'runtimeDriver'], 'bogus') },
  { name: 'heartbeat driftStatus invalid', mutate: setAt(['agents', 0, 'heartbeat', 'driftStatus'], 'bogus') },
  { name: 'heartbeat health invalid', mutate: setAt(['agents', 0, 'heartbeat', 'health'], 'bogus') },
  { name: 'heartbeat connectionStatus invalid', mutate: setAt(['agents', 0, 'heartbeat', 'connectionStatus'], 'bogus') },
  { name: 'required hostId missing', mutate: deleteAt(['agents', 0, 'enrollment', 'hostId']) }
])
