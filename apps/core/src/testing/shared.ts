import type {
  ActorId,
  CreateNodeTicketRequest,
  MNetRegionalProfile,
  MNetwork,
  MNetworkMember,
  MNode,
  PolicyApproval,
  PolicyApprovalVote,
  PolicyDecision,
  ServiceSummary
} from '../../../../packages/contracts/src/index.ts'

export type InMemoryOptions = {
  actor?: ActorId
  policyAvailable?: boolean
  auditAvailable?: boolean
  mNetAvailable?: boolean
  approvalReaderAvailable?: boolean
  networkProfileReaderAvailable?: boolean
  searchAvailable?: boolean
  introspectionAvailable?: boolean
  configPolicyRequired?: boolean
  approvals?: PolicyApproval[]
  approvalVotes?: PolicyApprovalVote[]
  networkProfiles?: MNetRegionalProfile[]
}

export type IdentityActorRecord = {
  id: ActorId
  displayName: string
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export type IdentityTokenRecord = {
  jti: string
  token: string
  actor: ActorId
  issuer: 'meristem-local'
  audience: 'meristem-core' | 'meristem-service'
  issuedAt: string
  expiresAt: string
  issuedBy: ActorId
  purpose: string
  status: 'active' | 'revoked' | 'expired'
  createdAt: string
  updatedAt: string
  revokedAt?: string
  revokedBy?: ActorId
  revokeReason?: string
  correlationId: string
}

export type SecretRefRecord = {
  id: string
  name: string
  scope: string
  status: 'active' | 'rotated' | 'disabled'
  createdBy: ActorId
  createdAt: string
  updatedAt: string
  metadata: Record<string, string>
}

export type SecretVersionRecord = {
  id: string
  secretRefId: string
  version: string
  value: string
  createdBy: ActorId
  createdAt: string
  disabledAt?: string
}

export type ConfigRecord = {
  id: string
  configVersion: string
  schemaVersion: string
  configHash: string
  domain: string
  targetScope: string[]
  status: 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
  payload: unknown
  createdBy: ActorId
  createdAt: string
  publishedBy?: ActorId
  publishedAt?: string
  rollbackVersion?: string
  updatedAt: string
}

export type ConfigAckRecord = {
  ackId: string
  configId: string
  version: string
  targetService: string
  status: string
  error?: string
  correlationId: string
  ackedAt: string
  expiresAt?: string
}

export type ConfigVersionRecord = {
  id: string
  configId: string
  version: string
  configHash: string
  payload: unknown
  status: ConfigRecord['status']
  createdBy: ActorId
  createdAt: string
}

export type JoinTicketRecord = CreateNodeTicketRequest & {
  createdBy: ActorId
  expiresAt: string
  ticket: string
}

export type NodeCredentialRecord = {
  token: string
  tokenHash: string
  status: 'active' | 'revoked'
  issuedAt: string
  lastUsedAt?: string
}

export type SimulatedAgentExecutionRecord = {
  completedAt: string
}

export function parseDurationMs(ttl: string): number | null {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(ttl)
  if (!match) return null

  const value = Number(match[1])
  const unit = match[2]
  const multiplier =
    unit === 'ms'
      ? 1
      : unit === 's'
        ? 1000
        : unit === 'm'
          ? 60_000
          : unit === 'h'
            ? 3_600_000
            : 86_400_000

  return value * multiplier
}

export function encodeMockJwt(payload: { jti: string; actor: string }): string {
  return `mock-jwt.${encodeURIComponent(JSON.stringify(payload))}.sig`
}

export function decodeMockJwt(token: string): { jti: string; actor: string } | null {
  const match = /^mock-jwt\.([^.]*)\.sig$/.exec(token)
  if (!match?.[1]) return null

  try {
    const decoded = JSON.parse(decodeURIComponent(match[1])) as { jti?: unknown; actor?: unknown }
    if (typeof decoded.jti !== 'string' || typeof decoded.actor !== 'string') {
      return null
    }
    return { jti: decoded.jti, actor: decoded.actor }
  } catch {
    return null
  }
}

export function latestSecretVersion(
  secretVersions: SecretVersionRecord[],
  secretRefId: string
): SecretVersionRecord | null {
  return secretVersions.filter(version => version.secretRefId === secretRefId).at(-1) ?? null
}

export function asServiceSummary(value: unknown): ServiceSummary | null {
  if (typeof value !== 'object' || value === null) return null

  const id = Reflect.get(value, 'id')
  const version = Reflect.get(value, 'version')
  const domain = Reflect.get(value, 'domain')
  const kind = Reflect.get(value, 'kind')

  if (
    typeof id !== 'string' ||
    typeof version !== 'string' ||
    typeof domain !== 'string' ||
    typeof kind !== 'string'
  ) {
    return null
  }

  const normalizedKind = kind === 'service' ? 'internal' : kind
  const validDomain =
    domain === 'core' ||
    domain === 'm-net' ||
    domain === 'm-eventbus' ||
    domain === 'm-log' ||
    domain === 'm-policy' ||
    domain === 'm-ui' ||
    domain === 'm-cli' ||
    domain === 'm-extension'
  const validKind =
    normalizedKind === 'core' ||
    normalizedKind === 'internal' ||
    normalizedKind === 'node' ||
    normalizedKind === 'task' ||
    normalizedKind === 'extension' ||
    normalizedKind === 'bff'

  if (!validDomain || !validKind) return null

  return {
    id,
    version,
    domain,
    kind: normalizedKind,
    lifecycle: { reloadable: false, rollbackable: false, degradable: true },
    runtime: {
      liveness: false,
      readiness: false,
      mode: 'degraded',
      lastError: 'runtime state is not exposed for this service definition'
    }
  }
}

export function createBuiltinServices(options: InMemoryOptions): ServiceSummary[] {
  return [
    {
      id: 'meristem-core',
      version: '0.1.0-test',
      domain: 'core',
      kind: 'core',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: true, mode: 'normal' }
    },
    {
      id: 'm-policy',
      version: '0.1.0-test',
      domain: 'm-policy',
      kind: 'internal',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: {
        liveness: true,
        readiness: options.policyAvailable !== false,
        mode: options.policyAvailable === false ? 'degraded' : 'normal'
      }
    },
    {
      id: 'm-log',
      version: '0.1.0-test',
      domain: 'm-log',
      kind: 'internal',
      lifecycle: { reloadable: true, rollbackable: false, degradable: true },
      runtime: {
        liveness: true,
        readiness: options.auditAvailable !== false,
        mode: options.auditAvailable === false ? 'degraded' : 'normal'
      }
    },
    {
      id: 'm-eventbus',
      version: '0.1.0-test',
      domain: 'm-eventbus',
      kind: 'internal',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: { liveness: true, readiness: true, mode: 'normal' }
    },
    {
      id: 'm-net',
      version: '0.1.0-test',
      domain: 'm-net',
      kind: 'internal',
      lifecycle: { reloadable: false, rollbackable: false, degradable: true },
      runtime: {
        liveness: true,
        readiness: options.mNetAvailable !== false,
        mode: options.mNetAvailable === false ? 'degraded' : 'normal'
      }
    }
  ]
}

export function createInitialActors(now: string): IdentityActorRecord[] {
  return [
    { id: 'viewer', displayName: 'Viewer', status: 'active', createdAt: now, updatedAt: now },
    { id: 'operator', displayName: 'Operator', status: 'active', createdAt: now, updatedAt: now },
    { id: 'admin', displayName: 'Admin', status: 'active', createdAt: now, updatedAt: now },
    {
      id: 'security-admin',
      displayName: 'Security Admin',
      status: 'active',
      createdAt: now,
      updatedAt: now
    }
  ]
}

export function configTransitionAllowed(
  fromStatus: ConfigRecord['status'],
  toStatus: ConfigRecord['status']
): boolean {
  const allowed: Record<ConfigRecord['status'], Array<ConfigRecord['status']>> = {
    draft: ['validated'],
    validated: ['published', 'failed'],
    published: ['applied', 'failed'],
    applied: ['rolled_back'],
    failed: ['rolled_back'],
    rolled_back: []
  }

  return allowed[fromStatus].includes(toStatus)
}

export function hasPlaintextSecretPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasPlaintextSecretPayload)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value).some(([key, entry]) => {
    const normalizedKey = key.toLowerCase()
    if (normalizedKey === 'secretref' || normalizedKey.endsWith('secretref')) return false
    if (
      /(password|secret|token|privatekey|apikey)/u.test(normalizedKey) &&
      typeof entry === 'string' &&
      entry.length > 0
    ) {
      return true
    }
    return hasPlaintextSecretPayload(entry)
  })
}

export type NodeRuntimePatch = Partial<
  Pick<MNode, 'status' | 'reachability' | 'lastSeenAt' | 'agentVersion'>
>

export type InMemoryCoreTestingHelpers = {
  actor: ActorId
  options: InMemoryOptions
  ensureAuditAvailable(
    code: string,
    message: string
  ): { ok: false; error: { code: string; message: string } } | null
  ensurePolicyAvailable(
    code: string,
    message: string
  ): { ok: false; error: { code: string; message: string } } | null
  configOpsRequirePolicy(): boolean
  markExpiredToken(record: IdentityTokenRecord): IdentityTokenRecord
}

export type InMemoryCoreTestingState = {
  nodes: MNode[]
  taskCount: { value: number }
  services: unknown[]
  networks: MNetwork[]
  memberships: MNetworkMember[]
  timeline: import('../../../../packages/contracts/src/index.ts').TimelineLog[]
  audit: import('../../../../packages/contracts/src/index.ts').AuditLog[]
  full: import('../../../../packages/contracts/src/index.ts').FullLog[]
  decisions: PolicyDecision[]
  joinTickets: Map<string, JoinTicketRecord>
  nodeCredentials: Map<string, NodeCredentialRecord>
  simulatedAgentExecutions: Map<string, SimulatedAgentExecutionRecord>
  actors: IdentityActorRecord[]
  actorTokens: IdentityTokenRecord[]
  secretRefs: SecretRefRecord[]
  secretVersions: SecretVersionRecord[]
  configRecords: ConfigRecord[]
  configVersions: ConfigVersionRecord[]
  configAcks: ConfigAckRecord[]
  builtinServices: ServiceSummary[]
}
