import type {
  ApprovalDetailResponseData,
  ApprovalQueueResponseData,
  AuditData,
  BffNetworkMapSummary,
  CommandState,
  DataPlaneStatusResponseData,
  GenericCommandParams,
  GlobalDefaultsResponseData,
  JoinTicketListResponseData,
  MigrationStatusResponseData,
  NetworkDetailResponseData,
  NetworkListResponseData,
  NetworkProfileDetailResponseData,
  NetworkProfileListResponseData,
  NodeListData,
  OverviewData,
  PolicyDecisionData,
  PolicyDecisionSummary,
  RouteRegistry,
  ServiceInspectorData,
  ServiceListData,
  TaskResult,
  TimelineData
} from './types'

export function getBffUrl(): string {
  return import.meta.env.VITE_MERISTEM_MUI_BFF_URL || 'http://localhost:3200'
}

type BffErrorEnvelope = {
  error: {
    code?: unknown
    message?: unknown
    correlationId?: unknown
  }
}

function isBffErrorEnvelope(value: unknown): value is BffErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const error = Reflect.get(value, 'error')
  return typeof error === 'object' && error !== null
}

/**
 * TokenInput 接受纯 JWT 或用户从 curl/CLI 里复制出来的 Authorization 头。
 * 这里统一收敛成 token 明文，避免发出 `Bearer Bearer <jwt>` 导致 Core 401。
 */
export function normalizeBearerTokenInput(input: string): string {
  const trimmed = input.trim()
  const bearer = /^Bearer\s+(.+)$/i.exec(trimmed)
  return (bearer?.[1] ?? trimmed).trim()
}

/** 将 Core/BFF error envelope 还原成可读 UI 错误，避免 401 被吞成泛化失败。 */
export function formatBffError(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (!isBffErrorEnvelope(error)) return fallback

  const message = typeof error.error.message === 'string' ? error.error.message : fallback
  const code = typeof error.error.code === 'string' ? error.error.code : null
  return code ? `${message} (${code})` : message
}

export async function bffFetch<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const normalizedToken = normalizeBearerTokenInput(token)
  const response = await fetch(`${getBffUrl()}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      ...(normalizedToken ? { authorization: `Bearer ${normalizedToken}` } : {}),
      'content-type': 'application/json'
    }
  })
  if (!response.ok) {
    const body = await response.json().catch(error => {
      console.warn(
        `m-ui bff: failed to parse error response for ${path} - ${error instanceof Error ? error.message : String(error)}`
      )
      return {
        error: { code: 'unknown', message: 'request failed' }
      }
    })
    throw body
  }
  const body: unknown = await response.json()
  return body as T
}

export function fetchOverview(token: string) {
  return bffFetch<OverviewData>('/api/v0/overview', token)
}

export function fetchRoutes(token: string) {
  return bffFetch<RouteRegistry>('/api/v0/routes', token)
}

export function fetchNodes(token: string) {
  return bffFetch<NodeListData>('/api/v0/nodes', token)
}

export function fetchTimeline(token: string) {
  return bffFetch<TimelineData>('/api/v0/timeline', token)
}

export function fetchAudit(token: string) {
  return bffFetch<AuditData>('/api/v0/audit', token)
}

export function fetchPolicyDecisions(token: string) {
  return bffFetch<PolicyDecisionData>('/api/v0/policy/decisions', token)
}

export function fetchServices(token: string) {
  return bffFetch<ServiceListData>('/api/v0/services', token)
}

export function fetchServiceDetail(token: string, serviceId: string) {
  return bffFetch<ServiceInspectorData>(`/api/v0/services/${encodeURIComponent(serviceId)}`, token)
}

export function fetchCommandState(token: string, leafNodeId: string) {
  return fetchCommandEligibility(token, 'task.noop.submit', { leafNodeId })
}

export function fetchCommandEligibility(
  token: string,
  commandId: string,
  params: GenericCommandParams
) {
  return bffFetch<CommandState>(
    `/api/v0/commands/${encodeURIComponent(commandId)}/eligibility`,
    token,
    {
      method: 'POST',
      body: JSON.stringify(params)
    }
  )
}

export function executeNoop(token: string, leafNodeId: string) {
  return executeCommand<TaskResult>(token, 'task.noop.submit', { leafNodeId })
}

export function executeCommand<T = unknown>(
  token: string,
  commandId: string,
  params: GenericCommandParams
) {
  return bffFetch<T>(`/api/v0/commands/${encodeURIComponent(commandId)}/execute`, token, {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

export function fetchPolicySummary(token: string, decisionId: string) {
  return bffFetch<{ decision: PolicyDecisionSummary }>(
    `/api/v0/policy/decisions/${decisionId}/summary`,
    token
  )
}

export function fetchApprovalQueue(token: string) {
  return bffFetch<ApprovalQueueResponseData>('/api/v0/policy/approvals', token)
}

export function fetchApprovalDetail(token: string, approvalId: string) {
  return bffFetch<ApprovalDetailResponseData>(
    `/api/v0/policy/approvals/${encodeURIComponent(approvalId)}`,
    token
  )
}

export function fetchNetworkProfiles(token: string) {
  return bffFetch<NetworkProfileListResponseData>('/api/v0/network-profiles', token)
}

export function fetchNetworkProfileDetail(token: string, profileVersion: string) {
  return bffFetch<NetworkProfileDetailResponseData>(
    `/api/v0/network-profiles/${encodeURIComponent(profileVersion)}`,
    token
  )
}

export function fetchNetworks(token: string) {
  return bffFetch<NetworkListResponseData>('/api/v0/networks', token)
}

export function fetchGlobalDefaults(token: string) {
  return bffFetch<GlobalDefaultsResponseData>('/api/v0/networks/defaults', token)
}

export function fetchMigrationStatus(token: string, operationId: string) {
  return bffFetch<MigrationStatusResponseData>(
    `/api/v0/networks/profile-switches/${encodeURIComponent(operationId)}`,
    token
  )
}

export function fetchNetworkDetail(token: string, networkId: string) {
  return bffFetch<NetworkDetailResponseData>(
    `/api/v0/networks/${encodeURIComponent(networkId)}`,
    token
  )
}

export function fetchNetworkJoinTickets(token: string, networkId: string) {
  return bffFetch<JoinTicketListResponseData>(
    `/api/v0/networks/${encodeURIComponent(networkId)}/join-tickets`,
    token
  )
}

export function fetchDataplaneStatus(token: string, networkId: string) {
  return bffFetch<DataPlaneStatusResponseData>(
    `/api/v0/networks/${encodeURIComponent(networkId)}/dataplane/status`,
    token
  )
}

export function fetchNetworkMapSummary(token: string, networkId: string) {
  return bffFetch<BffNetworkMapSummary>(
    `/api/v0/networks/${encodeURIComponent(networkId)}/dataplane/network-map`,
    token
  )
}

// Change fetchGlobalDefaults to point to /api/v0/networks/defaults
