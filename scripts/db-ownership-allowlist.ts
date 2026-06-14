type DomainName =
  | 'core'
  | 'm-extension'
  | 'm-log'
  | 'm-net'
  | 'm-policy'
  | 'm-task'

export type DbOwnerDomain = DomainName
export type DbOwnedTable = keyof typeof tableOwners

export type DbOwnershipException = {
  source: string
  tables: readonly string[]
  reason: string
}

export const sourceDomainRoots = [
  { prefix: 'apps/core/src/', domain: 'core' },
  { prefix: 'services/m-extension/src/', domain: 'm-extension' },
  { prefix: 'services/m-log/src/', domain: 'm-log' },
  { prefix: 'services/m-net/src/', domain: 'm-net' },
  { prefix: 'services/m-policy/src/', domain: 'm-policy' },
  { prefix: 'services/m-task/src/', domain: 'm-task' }
] as const satisfies readonly { prefix: string; domain: DomainName }[]

export const tableOwners = {
  users: 'm-policy',
  roles: 'm-policy',
  permissions: 'm-policy',
  userRoles: 'm-policy',
  rolePermissions: 'm-policy',
  nodes: 'core',
  nodeCredentials: 'core',
  nodeJoinTickets: 'core',
  actors: 'core',
  actorTokens: 'core',
  actorTokenRevocations: 'core',
  serviceDefinitions: 'core',
  tasks: 'core',
  taskDefinitions: 'm-task',
  taskRequests: 'm-task',
  taskTransitions: 'm-task',
  taskResults: 'm-task',
  taskCancellations: 'm-task',
  networks: 'm-net',
  networkMemberships: 'm-net',
  mnetProfileDefinitions: 'm-net',
  mnetNetworkProfileStates: 'm-net',
  mnetProfileTransitions: 'm-net',
  mnetSuspendedOperations: 'm-net',
  extensionDefinitions: 'm-extension',
  extensionInstances: 'm-extension',
  extensionTransitions: 'm-extension',
  secretRefs: 'core',
  secretRefVersions: 'core',
  secretRefTransitions: 'core',
  configRecords: 'core',
  configVersions: 'core',
  configTransitions: 'core',
  configApplyAcks: 'core',
  policyDecisions: 'm-policy',
  timelineLogs: 'm-log',
  fullLogs: 'm-log',
  auditLogs: 'm-log',
  projectorJobs: 'm-log',
  projectionCursors: 'm-log',
  projectionDLQ: 'm-log',
  policyApprovals: 'm-policy',
  policyApprovalVotes: 'm-policy',
  taskSuspendedOperations: 'm-task'
} as const satisfies Record<string, DomainName>

export const approvedCrossOwnerReads = [
  {
    source: 'services/m-task/src/storage-adapter.ts',
    tables: ['policyDecisions'],
    reason: 'M-Task validates M-Policy decision references before persisting task state.'
  },
  {
    source: 'services/m-task/src/suspended-operations.ts',
    tables: ['policyDecisions'],
    reason: 'M-Task suspended operation resume/reject flow verifies M-Policy decisions.'
  },
  {
    source: 'apps/core/src/adapters/auth.ts',
    tables: ['userRoles', 'rolePermissions'],
    reason: 'Core auth reads RBAC membership tables as the approved local auth exception.'
  },
  {
    source: 'services/m-net/src/agent-runtime-task-dispatch.ts',
    tables: ['nodes'],
    reason: 'M-Net dispatch checks Core-owned node facts when delivering tasks.'
  },
  {
    source: 'services/m-net/src/network-service.ts',
    tables: ['nodes'],
    reason: 'M-Net logical membership rules depend on Core-owned node kind facts.'
  },
  {
    source: 'services/m-net/src/shared.ts',
    tables: ['nodes'],
    reason: 'M-Net runtime mapping reuses Core-owned node row types.'
  },
  {
    source: 'services/m-net/src/agent-runtime-session-lifecycle.ts',
    tables: ['nodes', 'nodeCredentials', 'nodeJoinTickets'],
    reason: 'M-Net runtime session lifecycle redeems Core join tickets and updates node session facts.'
  }
] as const satisfies readonly DbOwnershipException[]

export function sourceDomainForFile(file: string): DbOwnerDomain | null {
  for (const root of sourceDomainRoots) {
    if (file.startsWith(root.prefix)) return root.domain
  }
  return null
}

export function approvedExceptionTablesForFile(file: string): ReadonlySet<string> {
  const matched = approvedCrossOwnerReads.find(entry => entry.source === file)
  return new Set(matched?.tables ?? [])
}

export function isDbOwnedTable(value: string): value is DbOwnedTable {
  return value in tableOwners
}
