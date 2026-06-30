import type { EventContract } from './schema-coverage.ts'
import { Contracts } from './schema-coverage.ts'

const netbirdConfigRef = { configRef: 'config/netbird/signal' } as const
const netbirdRelayConfigRef = { configRef: 'config/netbird/relay' } as const
const netbirdStunConfigRef = { configRef: 'config/netbird/stun' } as const

export const mnetV03EventContracts: EventContract[] = [
  {
    subject: 'mnet.sidecar.lifecycle.v0',
    schema: Contracts.MNetSidecarLifecycleEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      nodeId: 'node-v03-1',
      profileVersion: 'm-net@0.3.0',
      previousDesiredState: 'configure',
      desiredState: 'start',
      credentialStatus: 'ready',
      signalConfigRef: netbirdConfigRef,
      relayConfigRef: netbirdRelayConfigRef,
      stunConfigRef: netbirdStunConfigRef,
      correlationId: 'corr-sidecar-lifecycle-1',
      auditId: 'audit-sidecar-lifecycle-1'
    }
  },
  {
    subject: 'mnet.sidecar.health.v0',
    schema: Contracts.MNetSidecarHealthEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      nodeId: 'node-v03-1',
      profileVersion: 'm-net@0.3.0',
      healthStatus: 'healthy',
      previousHealthStatus: 'degraded',
      signalReachable: true,
      relayReachable: true,
      stunReachable: true,
      checkedAt: '2026-06-30T10:00:00.000Z',
      correlationId: 'corr-sidecar-health-1'
    }
  },
  {
    subject: 'mnet.topology.update.v0',
    schema: Contracts.MNetTopologyUpdateEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      profileVersion: 'm-net@0.3.0',
      topologyRevision: 'topology-42',
      routeClass: 'standard',
      sidecarDesiredState: 'start',
      affectedNodeIds: ['node-v03-1', 'node-v03-2'],
      policyDecisionId: 'pd-topology-1',
      auditId: 'audit-topology-1',
      correlationId: 'corr-topology-1'
    }
  },
  {
    subject: 'mnet.migration.required.v0',
    schema: Contracts.MNetMigrationRequiredEventPayloadSchema,
    fixture: {
      resourceKind: 'profile',
      networkId: 'net-cn-legacy',
      policyDecisionId: 'pd-migration-1',
      auditId: 'audit-migration-1',
      correlationId: 'corr-migration-1',
      migration: {
        code: 'migration_required',
        message: 'wstunnel production profile must migrate to NetBird CN profile v0.3.0',
        targetProfileVersion: 'm-net-cn@0.3.0',
        rebuildGuidanceKey: 'rebuild_node_with_netbird_sidecar',
        affectedProfileIds: ['m-net-cn@0.2.0'],
        affectedNodeIds: ['node-cn-1'],
        reasonCode: 'legacy_wstunnel_profile_v0_2'
      }
    }
  },
  {
    subject: 'mnet.forced_relay.change.v0',
    schema: Contracts.MNetForcedRelayChangeEventPayloadSchema,
    fixture: {
      networkId: 'net-cn-v03',
      profileVersion: 'm-net-cn@0.3.0',
      routeClass: 'forced-tcp-relay',
      selectorOwnership: 'policy',
      selector: {
        selectorType: 'label-selector',
        matchLabels: { region: 'cn' }
      },
      operatorOverrideActive: false,
      policyDecisionId: 'pd-relay-1',
      auditId: 'audit-relay-1',
      eventId: 'evt-relay-1',
      affectedNodeIds: ['node-cn-1', 'node-cn-2'],
      correlationId: 'corr-relay-change-1'
    }
  },
  {
    subject: 'mnet.credential.expiry.v0',
    schema: Contracts.MNetCredentialExpiryEventPayloadSchema,
    fixture: {
      networkId: 'net-v03',
      nodeId: 'node-v03-1',
      profileVersion: 'm-net@0.3.0',
      credentialRef: {
        provider: 'vault-kv-v2',
        keyPath: 'meristem/netbird/node-v03-1',
        version: 3
      },
      credentialStatus: 'rotation_required',
      expiresAt: '2026-07-01T10:00:00.000Z',
      correlationId: 'corr-credential-expiry-1',
      auditId: 'audit-credential-expiry-1'
    }
  }
]
