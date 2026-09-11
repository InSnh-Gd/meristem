import type {
  MNetBreakGlassGrantFromSchema,
  MNetClosedLoopEventSubjectFromSchema,
  MNetCredentialOperationFromSchema,
  MNetForcedRelayPolicyResultFromSchema,
  MNetJoinCredentialFromSchema,
  MNetPendingJoinRequestFromSchema,
  MNetProfileMigrationResultFromSchema,
  MNetSidecarStatusFromSchema,
  MNetTunnelHealthFromSchema
} from '../../../../packages/contracts/src/index.ts'

export type StoredRelayPolicy = Exclude<MNetForcedRelayPolicyResultFromSchema, { result: 'denied' }>

export type MNetClosedLoopEventIntent = {
  intentId: string
  operationId: string
  networkId: string
  subject: MNetClosedLoopEventSubjectFromSchema
  payload: unknown
  correlationId: string
  status: 'pending' | 'published'
  createdAt: string
  publishedAt?: string | undefined
  lastError?: string | undefined
}

export type MNetCredentialOperation = MNetCredentialOperationFromSchema

export type MNetClosedLoopFactWrite =
  | { kind: 'join'; value: MNetPendingJoinRequestFromSchema }
  | { kind: 'credential'; value: MNetJoinCredentialFromSchema }
  | { kind: 'credential-operation'; value: MNetCredentialOperation }
  | { kind: 'relay-policy'; value: StoredRelayPolicy }
  | { kind: 'migration'; value: MNetProfileMigrationResultFromSchema }
  | { kind: 'break-glass'; value: MNetBreakGlassGrantFromSchema }
  | { kind: 'sidecar'; networkId: string; value: MNetSidecarStatusFromSchema }
  | { kind: 'tunnel'; networkId: string; value: MNetTunnelHealthFromSchema }

export type MNetClosedLoopCommit = {
  facts: readonly MNetClosedLoopFactWrite[]
  eventIntents: readonly MNetClosedLoopEventIntent[]
}

export type MNetCredentialTransitionClaim = {
  credentialId: string
  expectedStatuses: readonly MNetJoinCredentialFromSchema['status'][]
  facts: readonly MNetClosedLoopFactWrite[]
}

export class MNetClosedLoopStorageError extends Error {
  readonly code: 'mnet.store.decode_failed' | 'mnet.store.write_failed'

  constructor(code: 'mnet.store.decode_failed' | 'mnet.store.write_failed', message: string) {
    super(message)
    this.code = code
  }
}

export type MNetClosedLoopStore = {
  commit(input: MNetClosedLoopCommit): Promise<void>
  claimCredentialTransition(input: MNetCredentialTransitionClaim): Promise<boolean>
  listPendingEventIntents(operationId?: string): Promise<MNetClosedLoopEventIntent[]>
  markEventIntentPublished(intentId: string, publishedAt: string): Promise<void>
  recordEventIntentFailure(intentId: string, errorCode: string): Promise<void>
  joins: {
    upsert(request: MNetPendingJoinRequestFromSchema): Promise<void>
    get(requestId: string): Promise<MNetPendingJoinRequestFromSchema | null>
    listByNetwork(networkId: string): Promise<MNetPendingJoinRequestFromSchema[]>
  }
  credentials: {
    upsert(credential: MNetJoinCredentialFromSchema): Promise<void>
    get(credentialId: string): Promise<MNetJoinCredentialFromSchema | null>
    listByNetwork(networkId: string): Promise<MNetJoinCredentialFromSchema[]>
  }
  credentialOperations: {
    get(operationId: string): Promise<MNetCredentialOperation | null>
    listPending(): Promise<MNetCredentialOperation[]>
  }
  relayPolicies: {
    upsert(policy: StoredRelayPolicy): Promise<void>
    get(networkId: string): Promise<StoredRelayPolicy | null>
  }
  migrations: {
    upsert(migration: MNetProfileMigrationResultFromSchema): Promise<void>
    get(migrationId: string): Promise<MNetProfileMigrationResultFromSchema | null>
  }
  breakGlass: {
    upsert(grant: MNetBreakGlassGrantFromSchema): Promise<void>
    get(grantId: string): Promise<MNetBreakGlassGrantFromSchema | null>
    listActiveByNetwork(networkId: string): Promise<MNetBreakGlassGrantFromSchema[]>
    listExpirable(): Promise<MNetBreakGlassGrantFromSchema[]>
  }
  sidecars: {
    upsert(networkId: string, status: MNetSidecarStatusFromSchema): Promise<void>
    listByNetwork(networkId: string): Promise<MNetSidecarStatusFromSchema[]>
  }
  tunnels: {
    upsert(networkId: string, health: MNetTunnelHealthFromSchema): Promise<void>
    listByNetwork(networkId: string): Promise<MNetTunnelHealthFromSchema[]>
  }
}
