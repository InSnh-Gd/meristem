import { relations } from 'drizzle-orm'

import { actors, actorTokenRevocations, actorTokens } from './identity.ts'
import { configApplyAcks, configRecords, configTransitions, configVersions } from './config.ts'
import { nodes, tasks } from './core.ts'
import { extensionDefinitions, extensionInstances, extensionTransitions } from './extension.ts'
import { auditLogs } from './log.ts'
import {
  mnetNetworkProfileStates,
  mnetProfileTransitions,
  mnetSuspendedOperations,
  networks
} from './network.ts'
import { policyApprovalVotes, policyApprovals, policyDecisions } from './policy.ts'
import { secretRefTransitions, secretRefVersions, secretRefs } from './secrets.ts'
import { taskRequests } from './task.ts'

export const nodesRelations = relations(nodes, ({ many }) => ({
  tasks: many(tasks)
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
  configTransitions: many(configTransitions)
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
  suspendedOperations: many(mnetSuspendedOperations)
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
