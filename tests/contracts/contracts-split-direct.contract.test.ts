import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import { MNetPolicyEvidenceSchema } from '../../packages/contracts/src/schemas/mnet-closed-loop-evidence.ts'
import {
  MNetClosedLoopEventSubjectSchema,
  MNetClosedLoopPublicationSchema
} from '../../packages/contracts/src/schemas/mnet-closed-loop-policy.ts'
import {
  MNetProfileV03Schema,
  MNetRouteClassSchema
} from '../../packages/contracts/src/schemas/mnet-profile-v03-contract.ts'
import { decodeMNetNodeV03Compatibility } from '../../packages/contracts/src/schemas/mnet-profile-v03-compatibility.ts'
import { MDeployApprovalStatusSchema } from '../../packages/contracts/src/schemas/mdeploy-operations-approval-runtime.ts'
import { MDeployStorageRefV01Schema } from '../../packages/contracts/src/schemas/mdeploy-operations-artifacts.ts'
import { MDeployApplyStatusSchema } from '../../packages/contracts/src/schemas/mdeploy-operations-lifecycle.ts'
import type { CoreDependencies } from '../../packages/contracts/src/types/core.ts'
import type { MNode } from '../../packages/contracts/src/types/node.ts'
import type { MTask } from '../../packages/contracts/src/types/task.ts'
import type { MNetwork } from '../../packages/contracts/src/types/network.ts'
import type { MNetSessionClientMessage } from '../../packages/contracts/src/types/session.ts'
import type { PolicyDecision } from '../../packages/contracts/src/types/policy-log.ts'
import type { NodeAgentRuntimeStatus } from '../../packages/contracts/src/types/node-agent-runtime.ts'

describe('contracts split direct seams', () => {
  it('decodes and rejects evidence module values directly', () => {
    expect(
      Schema.decodeUnknownSync(MNetPolicyEvidenceSchema)({
        policyDecisionId: 'decision-1',
        source: 'm-policy',
        outcome: 'allow',
        requiredPermission: 'network:join',
        reason: 'approved',
        decidedAt: '2026-01-01T00:00:00.000Z'
      }).source
    ).toBe('m-policy')
    expect(() => Schema.decodeUnknownSync(MNetPolicyEvidenceSchema)({})).toThrow()
    expect(
      Schema.decodeUnknownSync(MNetClosedLoopPublicationSchema)({
        status: 'pending',
        pendingSubjects: ['mnet.join.requested.v0']
      }).status
    ).toBe('pending')
    expect(() =>
      Schema.decodeUnknownSync(MNetClosedLoopPublicationSchema)({ status: 'pending' })
    ).toThrow()
  })

  it('decodes and rejects policy module values directly', () => {
    expect(
      Schema.decodeUnknownSync(MNetClosedLoopEventSubjectSchema)('mnet.join.requested.v0')
    ).toBe('mnet.join.requested.v0')
    expect(() => Schema.decodeUnknownSync(MNetClosedLoopEventSubjectSchema)('unknown')).toThrow()
  })

  it('decodes and rejects profile contract values directly', () => {
    const profile = {
      profileVersion: 'm-net@0.3.0',
      region: 'default',
      displayName: 'Default',
      schemaVersion: 'mnet-profile@0.3.0',
      status: 'available',
      rules: {},
      capabilities: {
        controlPlaneOnly: false,
        managementPlaneExcluded: true,
        realNetBirdSidecar: true,
        signalConfigRef: { configRef: 'signal/default' },
        relayConfigRef: { configRef: 'relay/default' },
        stunConfigRef: { configRef: 'stun/default' },
        sidecarDesiredState: 'start',
        sidecarCredentialRef: {
          provider: 'vault-kv-v2',
          keyPath: 'secret/data/mnet/sidecar',
          version: 1
        },
        sidecarCredentialStatus: 'ready',
        sidecarHealthStatus: 'healthy'
      }
    }
    expect(Schema.decodeUnknownSync(MNetProfileV03Schema)(profile).profileVersion).toBe(
      'm-net@0.3.0'
    )
    expect(() =>
      Schema.decodeUnknownSync(MNetProfileV03Schema)({ ...profile, schemaVersion: 'wrong' })
    ).toThrow()
    expect(Schema.decodeUnknownSync(MNetRouteClassSchema)('standard')).toBe('standard')
  })

  it('decodes and rejects profile compatibility values directly', () => {
    expect(
      decodeMNetNodeV03Compatibility({
        nodeId: 'node-1',
        profileVersion: 'm-net@0.3.0',
        transport: 'netbird-sidecar'
      }).kind
    ).toBe('node-ready')
    expect(() => decodeMNetNodeV03Compatibility({ nodeId: 'node-1' })).toThrow()
  })

  it('decodes and rejects approval-runtime values directly', () => {
    expect(Schema.decodeUnknownSync(MDeployApprovalStatusSchema)('pending')).toBe('pending')
    expect(() => Schema.decodeUnknownSync(MDeployApprovalStatusSchema)('unknown')).toThrow()
  })

  it('decodes and rejects artifact values directly', () => {
    const digest = { algorithm: 'sha256', value: 'a'.repeat(64) }
    expect(
      Schema.decodeUnknownSync(MDeployStorageRefV01Schema)({
        uri: 'oci://example/artifact',
        digest,
        redactionStatus: 'redacted'
      }).digest.value
    ).toBe(digest.value)
    expect(() => Schema.decodeUnknownSync(MDeployStorageRefV01Schema)({ uri: 'missing' })).toThrow()
  })

  it('decodes and rejects lifecycle values directly', () => {
    expect(Schema.decodeUnknownSync(MDeployApplyStatusSchema)('queued')).toBe('queued')
    expect(() => Schema.decodeUnknownSync(MDeployApplyStatusSchema)('unknown')).toThrow()
  })

  it('keeps pure type seams directly compilable', () => {
    const dependencies: CoreDependencies = {
      postgres: 'ready',
      nats: 'ready',
      'm-policy': 'ready',
      'm-log': 'ready',
      'm-eventbus': 'ready',
      'm-net': 'ready'
    }
    const node: MNode = {
      id: 'node-1',
      kind: 'leaf',
      name: 'Leaf',
      mode: 'agent',
      status: 'ready',
      reachability: 'reachable',
      capabilities: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const task: MTask = {
      id: 'task-1',
      nodeId: node.id,
      leafNodeId: node.id,
      type: 'noop',
      status: 'accepted',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    }
    const network: MNetwork = {
      id: 'network-1',
      name: 'Network',
      profileVersion: 'm-net@0.3.0',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const session: MNetSessionClientMessage = { type: 'join.redeem', ticket: 'ticket' }
    const policy: PolicyDecision = {
      id: 'decision-1',
      actor: 'admin',
      action: 'network:join',
      resource: network.id,
      result: 'allow',
      reasons: [],
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const runtime: NodeAgentRuntimeStatus = {
      kind: 'healthy',
      desiredState: 'start',
      credentialStatus: 'ready',
      healthStatus: 'healthy',
      correlationId: 'corr-1',
      observedAt: '2026-01-01T00:00:00.000Z',
      dependencies: { signal: 'ready', relay: 'ready', stun: 'ready' },
      degradedReasons: []
    }
    expect([
      dependencies.postgres,
      node.id,
      task.id,
      session.type,
      policy.result,
      runtime.kind
    ]).toEqual(['ready', 'node-1', 'task-1', 'join.redeem', 'allow', 'healthy'])
  })
})
