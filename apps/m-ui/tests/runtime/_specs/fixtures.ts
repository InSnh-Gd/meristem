import type {
  ApprovalDetailResponseData,
  ApprovalQueueResponseData,
  AuditData,
  CommandState,
  NetworkProfileDetailResponseData,
  NetworkProfileListResponseData,
  OverviewData,
  TaskResult,
  StateSourceMetadata
} from '../../../src/lib/types.ts'

const stateSource: StateSourceMetadata = {
  sourceType: 'authoritative',
  sourceId: 'fixture-source'
}

export function createOverviewFixture(): OverviewData {
  return {
    session: {
      actor: 'operator',
      permissions: []
    },
    core: {
      id: 'core-local',
      version: '0.1.0',
      mode: 'normal'
    },
    dependencies: {
      postgres: 'ready',
      nats: 'ready',
      'm-policy': 'ready',
      'm-log': 'ready',
      'm-eventbus': 'ready',
      'm-net': 'ready'
    },
    nodes: [
      {
        id: 'leaf-1',
        kind: 'leaf',
        name: 'Leaf 1',
        mode: 'agent',
        status: 'healthy',
        reachability: 'reachable',
        capabilities: ['task:submit'],
        createdAt: '2026-06-20T00:00:00.000Z'
      }
    ],
    services: [
      {
        id: 'm-policy',
        version: '0.1.0',
        domain: 'm-policy',
        kind: 'internal',
        lifecycle: {
          reloadable: true,
          rollbackable: false,
          degradable: true
        },
        runtime: {
          liveness: true,
          readiness: true,
          mode: 'normal'
        }
      }
    ],
    timeline: [
      {
        id: 'timeline-1',
        timestamp: '2026-06-20T00:00:00.000Z',
        summary: 'leaf node joined test-network',
        subject: 'node:leaf-1',
        correlationId: 'corr-1'
      }
    ],
    eventBusMetrics: {
      service: 'm-eventbus',
      generatedAt: '2026-06-20T00:00:00.000Z',
      windowStartedAt: '2026-06-20T00:00:00.000Z',
      totals: {
        success: 3,
        rejected: 1,
        failed: 0,
        retryAttempts: 1
      },
      subjects: [
        {
          subject: 'node.registered',
          success: 3,
          rejected: 0,
          failed: 0,
          retryAttempts: 1,
          lastOutcome: 'success',
          lastOutcomeAt: '2026-06-20T00:00:00.000Z'
        }
      ],
      lastRejected: {
        at: '2026-06-20T00:00:00.000Z',
        failedSubject: 'node.rejected',
        reason: 'subject_not_allowed',
        errors: ['blocked by fixture'],
        callerService: 'm-policy'
      }
    },
    auditAccessible: true,
    audit: [
      {
        id: 'audit-inline-1',
        timestamp: '2026-06-20T00:00:00.000Z',
        actor: 'operator',
        action: 'task.submit',
        resource: 'node/leaf-1',
        result: 'allowed'
      }
    ]
  }
}

export function createControlRoomCommandState(): CommandState {
  return {
    state: 'enabled',
    command: {
      id: 'task.submit.noop',
      label: '运行 noop 任务',
      action: 'task:submit',
      resource: 'node/leaf-1',
      risk: 'high',
      requiredPermissions: ['task:submit'],
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}

export function createTaskResultFixture(): TaskResult {
  return {
    task: {
      id: 'task-1',
      nodeId: 'stem-1',
      leafNodeId: 'leaf-1',
      type: 'noop',
      status: 'accepted',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:05.000Z'
    },
    policyDecisionId: 'decision-1',
    correlationId: 'corr-1',
    risk: {
      operationDangerLevel: 'high',
      suspicionScore: 12,
      riskFactors: ['task_type_risk', 'audit_visibility']
    }
  }
}

export function createForcedRelayResultFixture() {
  return {
    status: 'applied' as const,
    networkId: 'network-cn-001',
    nodeId: 'leaf-1',
    profileVersion: 'm-net-cn@0.3.0' as const,
    routeClass: 'forced-tcp-relay' as const,
    selectorOwnership: 'operator' as const,
    affectedNodeIds: ['leaf-1'],
    policyDecisionId: 'decision-relay-1',
    auditId: 'audit-relay-1',
    eventId: 'event-relay-1',
    correlationId: 'corr-relay-1',
    publishStatus: 'published' as const,
    snapshotStatus: 'healthy' as const
  }
}

export function createAuditFixture(): AuditData {
  return {
    entries: [
      {
        id: 'audit-1',
        timestamp: '2026-06-20T00:00:00.000Z',
        actor: 'operator',
        action: 'task.submit',
        resource: 'node/leaf-1',
        result: 'allowed',
        stateSource
      }
    ],
    stateSource
  }
}

export function createApprovalQueueFixture(): ApprovalQueueResponseData {
  return {
    approvals: [
      {
        id: 'approval-1',
        policyDecisionId: 'decision-1',
        originService: 'm-net',
        operationId: 'operation-1',
        requestedBy: 'operator',
        requiredAction: 'manual_review',
        status: 'pending',
        quorumRequired: 1,
        expiresAt: '2026-06-21T00:00:00.000Z',
        createdAt: '2026-06-20T00:00:00.000Z',
        updatedAt: '2026-06-20T00:00:00.000Z',
        stateSource
      }
    ],
    stateSource
  }
}

export function createApprovalDetailFixture(): ApprovalDetailResponseData {
  return {
    id: 'approval-1',
    policyDecisionId: 'decision-1',
    originService: 'm-net',
    operationId: 'operation-1',
    requestedBy: 'operator',
    requiredAction: 'manual_review',
    status: 'pending',
    quorumRequired: 1,
    expiresAt: '2026-06-21T00:00:00.000Z',
    createdAt: '2026-06-20T00:00:00.000Z',
    updatedAt: '2026-06-20T00:00:00.000Z',
    votes: [
      {
        id: 'vote-1',
        approvalId: 'approval-1',
        actor: 'operator',
        vote: 'approve',
        createdAt: '2026-06-20T00:30:00.000Z',
        reason: 'looks good'
      }
    ],
    stateSource
  }
}

export function createNetworkProfilesFixture(): NetworkProfileListResponseData {
  return {
    profiles: [
      {
        profileVersion: 'm-net-cn@0.3.0',
        region: 'cn',
        schemaVersion: 'mnet-profile@0.3.0',
        displayName: 'CN profile',
        status: 'available',
        capabilities: {
          controlPlaneOnly: false,
          managementPlaneExcluded: true,
          realNetBirdSidecar: true,
          signalConfigRef: { configRef: 'signal/cn-primary' },
          relayConfigRef: { configRef: 'relay/cn-primary' },
          stunConfigRef: { configRef: 'stun/cn-primary' },
          sidecarDesiredState: 'start',
          sidecarCredentialRef: {
            provider: 'vault-kv-v2',
            keyPath: 'secret/data/mnet/cn-sidecar',
            version: 1
          },
          sidecarCredentialStatus: 'ready',
          sidecarHealthStatus: 'healthy'
        },
        rules: {},
        forcedTcpRelaySelector: {
          enabled: true,
          selectorOwnership: 'policy',
          selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
          routeClass: 'forced-tcp-relay',
          operatorOverrideAllowed: false,
          operatorOverrideActive: false,
          policyDecision: {
            decisionId: 'fixture',
            source: 'm-policy',
            outcome: 'allow',
            reason: 'fixture'
          },
          auditEvidence: {
            auditId: 'fixture',
            eventId: 'fixture',
            eventSubject: 'mnet.forced_relay.change.v0'
          }
        },
        stateSource
      }
    ],
    stateSource
  }
}

export function createNetworkProfileDetailFixture(): NetworkProfileDetailResponseData {
  return {
    profileVersion: 'm-net-cn@0.3.0',
    region: 'cn',
    schemaVersion: 'mnet-profile@0.3.0',
    displayName: 'CN profile',
    status: 'available',
    capabilities: {
      controlPlaneOnly: false,
      managementPlaneExcluded: true,
      realNetBirdSidecar: true,
      signalConfigRef: { configRef: 'signal/cn-primary' },
      relayConfigRef: { configRef: 'relay/cn-primary' },
      stunConfigRef: { configRef: 'stun/cn-primary' },
      sidecarDesiredState: 'start',
      sidecarCredentialRef: {
        provider: 'vault-kv-v2',
        keyPath: 'secret/data/mnet/cn-sidecar',
        version: 1
      },
      sidecarCredentialStatus: 'ready',
      sidecarHealthStatus: 'healthy'
    },
    rules: {
      transport: 'netbird-sidecar',
      residency: 'cn-only'
    },
    forcedTcpRelaySelector: {
      enabled: true,
      selectorOwnership: 'policy',
      selector: { selectorType: 'all-leaf-nodes', includeAllLeafNodes: true },
      routeClass: 'forced-tcp-relay',
      operatorOverrideAllowed: false,
      operatorOverrideActive: false,
      policyDecision: {
        decisionId: 'fixture',
        source: 'm-policy',
        outcome: 'allow',
        reason: 'fixture'
      },
      auditEvidence: {
        auditId: 'fixture',
        eventId: 'fixture',
        eventSubject: 'mnet.forced_relay.change.v0'
      }
    },
    stateSource
  }
}

export function createBreakGlassCommandState(): CommandState {
  return {
    state: 'enabled',
    command: {
      id: 'network.break-glass.execute',
      label: '执行紧急预案',
      action: 'network:break-glass',
      resource: 'network/test-network',
      risk: 'high',
      requiredPermissions: ['network:break-glass'],
      requiresPolicy: true,
      requiresAudit: true
    }
  }
}
