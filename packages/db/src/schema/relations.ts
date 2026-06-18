import { relations } from 'drizzle-orm'
import { configApplyAcks, configRecords, configTransitions, configVersions } from './config.ts'
import { nodes, tasks } from './core.ts'
import { extensionDefinitions, extensionInstances, extensionTransitions } from './extension.ts'
import { actors, actorTokenRevocations, actorTokens } from './identity.ts'
import { auditLogs } from './log.ts'
import {
  mnetGlobalDefaults,
  mnetProfileDefaultSetResults,
  mnetProfileDisablePolicies,
  mnetProfileSwitchBatches,
  mnetProfileSwitchBatchMembers,
  mnetProfileSwitchOperations,
  mnetProfileSwitchResults,
  mnetProfileSwitchSnapshots
} from './mnet-control.ts'
import {
  mnetDataPlaneOperationLocks,
  mnetNetworkMapRenders,
  mnetNodePublicKeys,
  mnetPartitionStates,
  mnetProfileMigrations,
  mnetRelayAssignments,
  mnetSidecarDesiredConfigs,
  mnetTunnelAddressAllocations
} from './mnet-dataplane.ts'
import {
  mnetNetworkProfileStates,
  mnetProfileTransitions,
  mnetSuspendedOperations,
  networks
} from './network.ts'
import { policyApprovals, policyApprovalVotes, policyDecisions } from './policy.ts'
import { secretRefs, secretRefTransitions, secretRefVersions } from './secrets.ts'
import { taskRequests } from './task.ts'

export const nodesRelations = relations(nodes, ({ many }) => ({
  tasks: many(tasks),
  publicKeys: many(mnetNodePublicKeys),
  tunnelAllocations: many(mnetTunnelAddressAllocations),
  relayAssignments: many(mnetRelayAssignments),
  sidecarDesiredConfigs: many(mnetSidecarDesiredConfigs)
}))

export const tasksRelations = relations(tasks, ({ one }) => ({
  node: one(nodes, { fields: [tasks.leafNodeId], references: [nodes.id] })
}))

export const actorsRelations = relations(actors, ({ many }) => ({
  tokens: many(actorTokens)
}))

export const actorTokensRelations = relations(actorTokens, ({ one }) => ({
  actor: one(actors, { fields: [actorTokens.actorId], references: [actors.id] }),
  revocation: one(actorTokenRevocations, {
    fields: [actorTokens.jti],
    references: [actorTokenRevocations.jti]
  })
}))

export const actorTokenRevocationsRelations = relations(actorTokenRevocations, ({ one }) => ({
  token: one(actorTokens, { fields: [actorTokenRevocations.jti], references: [actorTokens.jti] })
}))

export const policyDecisionsRelations = relations(policyDecisions, ({ many }) => ({
  secretRefTransitions: many(secretRefTransitions),
  configTransitions: many(configTransitions),
  mnetProfileDefaultSetResults: many(mnetProfileDefaultSetResults)
}))

export const secretRefsRelations = relations(secretRefs, ({ many }) => ({
  versions: many(secretRefVersions),
  transitions: many(secretRefTransitions)
}))

export const secretRefVersionsRelations = relations(secretRefVersions, ({ one }) => ({
  secretRef: one(secretRefs, {
    fields: [secretRefVersions.secretRefId],
    references: [secretRefs.id]
  })
}))

export const secretRefTransitionsRelations = relations(secretRefTransitions, ({ one }) => ({
  secretRef: one(secretRefs, {
    fields: [secretRefTransitions.secretRefId],
    references: [secretRefs.id]
  }),
  policyDecision: one(policyDecisions, {
    fields: [secretRefTransitions.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const configRecordsRelations = relations(configRecords, ({ many }) => ({
  versions: many(configVersions),
  transitions: many(configTransitions),
  applyAcks: many(configApplyAcks)
}))

export const configVersionsRelations = relations(configVersions, ({ one }) => ({
  config: one(configRecords, { fields: [configVersions.configId], references: [configRecords.id] })
}))

export const configTransitionsRelations = relations(configTransitions, ({ one }) => ({
  config: one(configRecords, {
    fields: [configTransitions.configId],
    references: [configRecords.id]
  }),
  policyDecision: one(policyDecisions, {
    fields: [configTransitions.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const configApplyAcksRelations = relations(configApplyAcks, ({ one }) => ({
  config: one(configRecords, { fields: [configApplyAcks.configId], references: [configRecords.id] })
}))

export const taskRequestsRelations = relations(taskRequests, ({ one }) => ({
  node: one(nodes, { fields: [taskRequests.nodeId], references: [nodes.id] }),
  policyDecision: one(policyDecisions, {
    fields: [taskRequests.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const networksRelations = relations(networks, ({ many }) => ({
  profileStates: many(mnetNetworkProfileStates),
  profileTransitions: many(mnetProfileTransitions),
  suspendedOperations: many(mnetSuspendedOperations),
  profileMigrations: many(mnetProfileMigrations),
  networkMapRenders: many(mnetNetworkMapRenders),
  tunnelAllocations: many(mnetTunnelAddressAllocations),
  relayAssignments: many(mnetRelayAssignments),
  dataPlaneOperationLocks: many(mnetDataPlaneOperationLocks),
  partitionStates: many(mnetPartitionStates),
  switchBatchMembers: many(mnetProfileSwitchBatchMembers),
  switchResults: many(mnetProfileSwitchResults),
  switchSnapshots: many(mnetProfileSwitchSnapshots)
}))

export const mnetNetworkProfileStatesRelations = relations(mnetNetworkProfileStates, ({ one }) => ({
  network: one(networks, {
    fields: [mnetNetworkProfileStates.networkId],
    references: [networks.id]
  }),
  policyDecision: one(policyDecisions, {
    fields: [mnetNetworkProfileStates.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const mnetProfileTransitionsRelations = relations(mnetProfileTransitions, ({ one }) => ({
  network: one(networks, { fields: [mnetProfileTransitions.networkId], references: [networks.id] }),
  policyDecision: one(policyDecisions, {
    fields: [mnetProfileTransitions.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const mnetSuspendedOperationsRelations = relations(mnetSuspendedOperations, ({ one }) => ({
  network: one(networks, {
    fields: [mnetSuspendedOperations.networkId],
    references: [networks.id]
  }),
  policyDecision: one(policyDecisions, {
    fields: [mnetSuspendedOperations.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const mnetGlobalDefaultsRelations = relations(mnetGlobalDefaults, () => ({}))

export const mnetProfileSwitchOperationsRelations = relations(
  mnetProfileSwitchOperations,
  ({ many }) => ({
    batches: many(mnetProfileSwitchBatches),
    batchMembers: many(mnetProfileSwitchBatchMembers),
    results: many(mnetProfileSwitchResults),
    snapshots: many(mnetProfileSwitchSnapshots)
  })
)

export const mnetProfileSwitchBatchesRelations = relations(
  mnetProfileSwitchBatches,
  ({ one, many }) => ({
    operation: one(mnetProfileSwitchOperations, {
      fields: [mnetProfileSwitchBatches.operationId],
      references: [mnetProfileSwitchOperations.operationId]
    }),
    members: many(mnetProfileSwitchBatchMembers)
  })
)

export const mnetProfileSwitchBatchMembersRelations = relations(
  mnetProfileSwitchBatchMembers,
  ({ one }) => ({
    operation: one(mnetProfileSwitchOperations, {
      fields: [mnetProfileSwitchBatchMembers.operationId],
      references: [mnetProfileSwitchOperations.operationId]
    }),
    network: one(networks, {
      fields: [mnetProfileSwitchBatchMembers.networkId],
      references: [networks.id]
    })
  })
)

export const mnetProfileSwitchResultsRelations = relations(mnetProfileSwitchResults, ({ one }) => ({
  operation: one(mnetProfileSwitchOperations, {
    fields: [mnetProfileSwitchResults.operationId],
    references: [mnetProfileSwitchOperations.operationId]
  }),
  network: one(networks, {
    fields: [mnetProfileSwitchResults.networkId],
    references: [networks.id]
  })
}))

export const mnetProfileSwitchSnapshotsRelations = relations(
  mnetProfileSwitchSnapshots,
  ({ one }) => ({
    operation: one(mnetProfileSwitchOperations, {
      fields: [mnetProfileSwitchSnapshots.operationId],
      references: [mnetProfileSwitchOperations.operationId]
    }),
    network: one(networks, {
      fields: [mnetProfileSwitchSnapshots.networkId],
      references: [networks.id]
    })
  })
)

export const mnetProfileDefaultSetResultsRelations = relations(
  mnetProfileDefaultSetResults,
  ({ one }) => ({
    policyDecision: one(policyDecisions, {
      fields: [mnetProfileDefaultSetResults.policyDecisionId],
      references: [policyDecisions.id]
    })
  })
)

export const mnetProfileDisablePoliciesRelations = relations(mnetProfileDisablePolicies, () => ({}))

export const mnetProfileMigrationsRelations = relations(mnetProfileMigrations, ({ one }) => ({
  network: one(networks, {
    fields: [mnetProfileMigrations.networkId],
    references: [networks.id]
  })
}))

export const mnetNetworkMapRendersRelations = relations(mnetNetworkMapRenders, ({ one }) => ({
  network: one(networks, {
    fields: [mnetNetworkMapRenders.networkId],
    references: [networks.id]
  })
}))

export const mnetNodePublicKeysRelations = relations(mnetNodePublicKeys, ({ one }) => ({
  node: one(nodes, {
    fields: [mnetNodePublicKeys.nodeId],
    references: [nodes.id]
  })
}))

export const mnetPartitionStatesRelations = relations(mnetPartitionStates, ({ one }) => ({
  network: one(networks, {
    fields: [mnetPartitionStates.networkId],
    references: [networks.id]
  })
}))

export const mnetTunnelAddressAllocationsRelations = relations(
  mnetTunnelAddressAllocations,
  ({ one }) => ({
    network: one(networks, {
      fields: [mnetTunnelAddressAllocations.networkId],
      references: [networks.id]
    }),
    node: one(nodes, {
      fields: [mnetTunnelAddressAllocations.nodeId],
      references: [nodes.id]
    })
  })
)

export const mnetRelayAssignmentsRelations = relations(mnetRelayAssignments, ({ one }) => ({
  network: one(networks, {
    fields: [mnetRelayAssignments.networkId],
    references: [networks.id]
  }),
  relayNode: one(nodes, {
    fields: [mnetRelayAssignments.relayId],
    references: [nodes.id]
  })
}))

export const mnetDataPlaneOperationLocksRelations = relations(
  mnetDataPlaneOperationLocks,
  ({ one }) => ({
    network: one(networks, {
      fields: [mnetDataPlaneOperationLocks.networkId],
      references: [networks.id]
    })
  })
)

export const mnetSidecarDesiredConfigsRelations = relations(
  mnetSidecarDesiredConfigs,
  ({ one }) => ({
    node: one(nodes, {
      fields: [mnetSidecarDesiredConfigs.nodeId],
      references: [nodes.id]
    })
  })
)

export const extensionInstancesRelations = relations(extensionInstances, ({ one }) => ({
  extension: one(extensionDefinitions, {
    fields: [extensionInstances.extensionId],
    references: [extensionDefinitions.id]
  }),
  policyDecision: one(policyDecisions, {
    fields: [extensionInstances.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const extensionTransitionsRelations = relations(extensionTransitions, ({ one }) => ({
  extension: one(extensionDefinitions, {
    fields: [extensionTransitions.extensionId],
    references: [extensionDefinitions.id]
  }),
  instance: one(extensionInstances, {
    fields: [extensionTransitions.instanceId],
    references: [extensionInstances.id]
  }),
  policyDecision: one(policyDecisions, {
    fields: [extensionTransitions.policyDecisionId],
    references: [policyDecisions.id]
  })
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  policyDecision: one(policyDecisions, {
    fields: [auditLogs.decisionId],
    references: [policyDecisions.id]
  })
}))

export const policyApprovalsRelations = relations(policyApprovals, ({ many, one }) => ({
  decision: one(policyDecisions, {
    fields: [policyApprovals.policyDecisionId],
    references: [policyDecisions.id]
  }),
  votes: many(policyApprovalVotes)
}))

export const policyApprovalVotesRelations = relations(policyApprovalVotes, ({ one }) => ({
  approval: one(policyApprovals, {
    fields: [policyApprovalVotes.approvalId],
    references: [policyApprovals.id]
  })
}))
