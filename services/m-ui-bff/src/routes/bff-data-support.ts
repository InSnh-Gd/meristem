export function toOverviewNode(node: {
  readonly id: string
  readonly kind: string
  readonly name: string
  readonly mode: string
  readonly status: string
  readonly reachability: string
  readonly capabilities: readonly string[]
  readonly createdAt: string
  readonly lastSeenAt?: string | undefined
  readonly agentVersion?: string | undefined
}) {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    mode: node.mode,
    status: node.status,
    reachability: node.reachability,
    ...(node.lastSeenAt !== undefined ? { lastSeenAt: node.lastSeenAt } : {}),
    ...(node.agentVersion !== undefined ? { agentVersion: node.agentVersion } : {}),
    capabilities: [...node.capabilities],
    createdAt: node.createdAt
  }
}

export function toOverviewService(service: {
  readonly id: string
  readonly version: string
  readonly domain: string
  readonly kind: string
  readonly lifecycle: {
    readonly reloadable: boolean
    readonly rollbackable: boolean
    readonly degradable: boolean
  }
  readonly runtime?:
    | {
        readonly liveness: boolean
        readonly readiness: boolean
        readonly mode: string
        readonly lastError?: string | undefined
        readonly lastReloadedAt?: string | undefined
      }
    | undefined
}) {
  return {
    id: service.id,
    version: service.version,
    domain: service.domain,
    kind: service.kind,
    lifecycle: { ...service.lifecycle },
    ...(service.runtime !== undefined
      ? {
          runtime: {
            liveness: service.runtime.liveness,
            readiness: service.runtime.readiness,
            mode: service.runtime.mode,
            ...(service.runtime.lastError !== undefined
              ? { lastError: service.runtime.lastError }
              : {}),
            ...(service.runtime.lastReloadedAt !== undefined
              ? { lastReloadedAt: service.runtime.lastReloadedAt }
              : {})
          }
        }
      : {})
  }
}

export function toOverviewTimelineEntry(entry: {
  readonly id: string
  readonly timestamp: string
  readonly summary: string
  readonly subject?: string | undefined
  readonly correlationId?: string | undefined
}) {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    summary: entry.summary,
    ...(entry.subject !== undefined ? { subject: entry.subject } : {}),
    ...(entry.correlationId !== undefined ? { correlationId: entry.correlationId } : {})
  }
}

export function toOverviewAuditEntry(entry: {
  readonly id: string
  readonly timestamp: string
  readonly actor: string
  readonly action: string
  readonly resource: string
  readonly result: string
  readonly decisionId?: string | undefined
  readonly correlationId?: string | undefined
  readonly traceId?: string | undefined
  readonly payload?: unknown
}) {
  return {
    id: entry.id,
    timestamp: entry.timestamp,
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    result: entry.result,
    ...(entry.decisionId !== undefined ? { decisionId: entry.decisionId } : {}),
    ...(entry.correlationId !== undefined ? { correlationId: entry.correlationId } : {}),
    ...(entry.traceId !== undefined ? { traceId: entry.traceId } : {}),
    ...(entry.payload !== undefined ? { payload: entry.payload } : {})
  }
}

export function toOverviewStatus(status: {
  readonly core: {
    readonly id: string
    readonly version: string
    readonly mode: string
  }
  readonly dependencies: Record<string, unknown>
}) {
  return {
    core: status.core,
    dependencies: status.dependencies
  }
}
