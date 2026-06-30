import {
  executeCommand,
  fetchApprovalDetail as fetchBffApprovalDetail,
  fetchApprovalQueue as fetchBffApprovalQueue,
  fetchAudit as fetchBffAudit,
  fetchDataplaneStatus as fetchBffDataplaneStatus,
  fetchGlobalDefaults as fetchBffGlobalDefaults,
  fetchNetworkJoinTickets as fetchBffJoinTickets,
  fetchNetworkDetail as fetchBffNetworkDetail,
  fetchNetworkProfileDetail as fetchBffNetworkProfileDetail,
  fetchNetworkProfiles as fetchBffNetworkProfiles,
  fetchNetworks as fetchBffNetworks,
  fetchNodes as fetchBffNodes,
  fetchPolicyDecisions as fetchBffPolicyDecisions,
  fetchRoutes as fetchBffRoutes,
  fetchServices as fetchBffServices,
  fetchTimeline as fetchBffTimeline,
  fetchCommandState,
  fetchForcedRelayCommandState,
  fetchOverview,
  fetchPolicySummary,
  formatBffError,
  fetchOperationalState,
  createNetwork
} from './bff'
import type {
  ApprovalDetailResponseData,
  ApprovalQueueResponseData,
  AuditData,
  AuditEntry,
  CommandState,
  CommandResult,
  DataPlaneStatusResponseData,
  GenericCommandParams,
  GlobalDefaultsResponseData,
  JoinTicketListResponseData,
  NetworkDetailResponseData,
  NetworkListResponseData,
  NetworkProfileDetailResponseData,
  NetworkProfileListResponseData,
  NodeListData,
  OverviewData,
  PolicyDecisionData,
  PolicyDecisionSummary,
  RouteRegistry,
  ServiceListData,
  TimelineData,
  OperationalStateData
} from './types'

declare const $state: <T>(initial: T) => T
declare const $derived: {
  <T>(expression: T): T
  by<T>(fn: () => T): T
}

class AppState {
  token = $state(import.meta.env.PUBLIC_MERISTEM_DEFAULT_TOKEN ?? '')
  loading = $state(false)
  error = $state<string | null>(null)
  overview = $state<OverviewData | null>(null)
  selectedNodeId = $state<string | null>(null)
  commandState = $state<CommandState | null>(null)
  commandStateError = $state<string | null>(null)
  commandExecutionError = $state<string | null>(null)
  commandParams = $state<Record<string, unknown> | null>(null)
  taskResult = $state<CommandResult | null>(null)
  commandConfirming = $state(false)
  policySummary = $state<PolicyDecisionSummary | null>(null)
  policySummaryError = $state<string | null>(null)
  routes = $state<RouteRegistry | null>(null)
  nodes = $state<NodeListData | null>(null)
  timeline = $state<TimelineData | null>(null)
  audit = $state<AuditData | null>(null)
  policyDecisions = $state<PolicyDecisionData | null>(null)
  services = $state<ServiceListData | null>(null)
  approvalQueue = $state<ApprovalQueueResponseData | null>(null)
  approvalQueueLoading = $state(false)
  approvalQueueError = $state<string | null>(null)
  selectedApproval = $state<ApprovalDetailResponseData | null>(null)
  selectedApprovalLoading = $state(false)
  selectedApprovalError = $state<string | null>(null)
  networkProfiles = $state<NetworkProfileListResponseData | null>(null)
  networkProfilesLoading = $state(false)
  networkProfilesError = $state<string | null>(null)
  selectedProfile = $state<NetworkProfileDetailResponseData | null>(null)
  selectedProfileLoading = $state(false)
  selectedProfileError = $state<string | null>(null)
  networks = $state<NetworkListResponseData | null>(null)
  networksLoading = $state(false)
  networksError = $state<string | null>(null)
  selectedNetwork = $state<NetworkDetailResponseData | null>(null)
  selectedNetworkLoading = $state(false)
  selectedNetworkError = $state<string | null>(null)
  joinTickets = $state<JoinTicketListResponseData | null>(null)
  joinTicketsLoading = $state(false)
  dataplaneStatus = $state<DataPlaneStatusResponseData | null>(null)
  dataplaneStatusError = $state<string | null>(null)
  globalDefaults = $state<GlobalDefaultsResponseData | null>(null)
  globalDefaultsLoading = $state(false)
  globalDefaultsError = $state<string | null>(null)
  operationalState = $state<OperationalStateData | null>(null)
  operationalStateLoading = $state(false)
  operationalStateError = $state<string | null>(null)

  actor = $derived(this.overview?.session.actor ?? null)
  permissions = $derived(this.overview?.session.permissions ?? [])
  auditEntries: AuditEntry[] | null = $derived(this.audit?.entries ?? this.overview?.audit ?? null)
  selectedNode = $derived.by(() => {
    if (!this.selectedNodeId) return null
    return (
      this.nodes?.nodes.find(
        (node: NodeListData['nodes'][number]) => node.id === this.selectedNodeId
      ) ??
      this.overview?.nodes.find(
        (node: OverviewData['nodes'][number]) => node.id === this.selectedNodeId
      ) ??
      null
    )
  })

  async refresh() {
    if (!this.token) return
    this.loading = true
    this.error = null
    try {
      this.overview = await fetchOverview(this.token)
      await Promise.all([
        this.fetchRoutes(),
        this.fetchNodes(),
        this.fetchTimeline(),
        this.fetchServices(),
        this.fetchPolicyDecisions(),
        this.overview.auditAccessible ? this.fetchAudit() : Promise.resolve(this.clearAudit())
      ])
    } catch (e: unknown) {
      this.error = formatBffError(e, '加载失败')
    } finally {
      this.loading = false
    }
  }

  async fetchRoutes() {
    if (!this.token) return
    this.routes = await fetchBffRoutes(this.token)
  }

  async fetchNodes() {
    if (!this.token) return
    this.nodes = await fetchBffNodes(this.token)
  }

  async fetchTimeline() {
    if (!this.token) return
    this.timeline = await fetchBffTimeline(this.token)
  }

  async fetchAudit() {
    if (!this.token) return
    this.audit = await fetchBffAudit(this.token)
  }

  async fetchPolicyDecisions() {
    if (!this.token) return
    this.policyDecisions = await fetchBffPolicyDecisions(this.token)
  }

  async fetchServices() {
    if (!this.token) return
    this.services = await fetchBffServices(this.token)
  }

  async fetchApprovalQueue() {
    if (!this.token) return
    this.approvalQueueLoading = true
    this.approvalQueueError = null
    try {
      this.approvalQueue = await fetchBffApprovalQueue(this.token)
    } catch (e: unknown) {
      this.approvalQueueError = formatBffError(e, '审批队列加载失败')
    } finally {
      this.approvalQueueLoading = false
    }
  }

  async fetchApprovalDetail(approvalId: string) {
    if (!this.token) return
    this.selectedApprovalLoading = true
    this.selectedApprovalError = null
    try {
      this.selectedApproval = await fetchBffApprovalDetail(this.token, approvalId)
    } catch (e: unknown) {
      this.selectedApproval = null
      this.selectedApprovalError = formatBffError(e, '审批详情加载失败')
    } finally {
      this.selectedApprovalLoading = false
    }
  }

  async fetchNetworkProfiles() {
    if (!this.token) return
    this.networkProfilesLoading = true
    this.networkProfilesError = null
    try {
      this.networkProfiles = await fetchBffNetworkProfiles(this.token)
    } catch (e: unknown) {
      this.networkProfilesError = formatBffError(e, '网络配置加载失败')
    } finally {
      this.networkProfilesLoading = false
    }
  }

  async fetchNetworkProfileDetail(profileVersion: string) {
    if (!this.token) return
    this.selectedProfileLoading = true
    this.selectedProfileError = null
    try {
      this.selectedProfile = await fetchBffNetworkProfileDetail(this.token, profileVersion)
    } catch (e: unknown) {
      this.selectedProfile = null
      this.selectedProfileError = formatBffError(e, '网络配置详情加载失败')
    } finally {
      this.selectedProfileLoading = false
    }
  }

  async fetchNetworks() {
    if (!this.token) return
    this.networksLoading = true
    this.networksError = null
    try {
      this.networks = await fetchBffNetworks(this.token)
    } catch (e: unknown) {
      this.networksError = formatBffError(e, '网络列表加载失败')
    } finally {
      this.networksLoading = false
    }
  }

  async fetchNetworkDetail(networkId: string) {
    if (!this.token) return
    this.selectedNetworkLoading = true
    this.selectedNetworkError = null
    try {
      this.selectedNetwork = await fetchBffNetworkDetail(this.token, networkId)
    } catch (e: unknown) {
      this.selectedNetwork = null
      this.selectedNetworkError = formatBffError(e, '网络详情加载失败')
    } finally {
      this.selectedNetworkLoading = false
    }
  }

  async fetchJoinTickets(networkId: string) {
    if (!this.token) return
    this.joinTicketsLoading = true
    try {
      this.joinTickets = await fetchBffJoinTickets(this.token, networkId)
    } finally {
      this.joinTicketsLoading = false
    }
  }

  async fetchDataplaneStatus(networkId: string) {
    if (!this.token) return
    this.dataplaneStatusError = null
    try {
      this.dataplaneStatus = await fetchBffDataplaneStatus(this.token, networkId)
    } catch (e: unknown) {
      this.dataplaneStatus = null
      this.dataplaneStatusError = formatBffError(e, '数据面状态加载失败')
    }
  }

  async fetchGlobalDefaults() {
    if (!this.token) return
    this.globalDefaultsLoading = true
    this.globalDefaultsError = null
    try {
      this.globalDefaults = await fetchBffGlobalDefaults(this.token)
    } catch (e: unknown) {
      this.globalDefaults = null
      this.globalDefaultsError = formatBffError(e, '全局控制状态加载失败')
    } finally {
      this.globalDefaultsLoading = false
    }
  }

  async fetchOperationalState(networkId: string) {
    if (!this.token || !networkId) return
    this.operationalStateLoading = true
    this.operationalStateError = null
    try {
      this.operationalState = await fetchOperationalState(this.token, networkId)
    } catch (e: unknown) {
      this.operationalState = null
      this.operationalStateError = formatBffError(e, '运营状态加载失败')
    } finally {
      this.operationalStateLoading = false
    }
  }

  async createNetwork(name: string, profileVersion?: string) {
    if (!this.token) return
    this.loading = true
    this.error = null
    try {
      const res = await createNetwork(this.token, name, profileVersion)
      await this.fetchNetworks()
      return res
    } catch (e: unknown) {
      this.error = formatBffError(e, '创建网络失败')
      throw e
    } finally {
      this.loading = false
    }
  }

  clearAudit() {
    this.audit = null
  }

  async selectNode(nodeId: string) {
    this.selectedNodeId = nodeId
    this.taskResult = null
    this.commandExecutionError = null
    this.commandConfirming = false
    this.commandStateError = null
    if (this.token && nodeId) {
      try {
        this.commandState = await fetchForcedRelayCommandState(this.token, nodeId)
      } catch (e: unknown) {
        try {
          this.commandState = await fetchCommandState(this.token, nodeId)
        } catch (fallbackError: unknown) {
          this.commandState = null
          this.commandStateError = formatBffError(fallbackError, '操作状态加载失败')
        }
      }
    }
  }

  async executeGenericCommand() {
    if (!this.token || !this.commandState?.command || !this.commandParams) return
    this.commandConfirming = false
    this.loading = true
    this.error = null
    this.commandExecutionError = null
    this.taskResult = null
    try {
      this.taskResult = await executeCommand(
        this.token,
        this.commandState.command.id,
        this.commandParams as GenericCommandParams
      )
      // fetch policy summary if applicable
      if (this.taskResult?.policyDecisionId) {
        await this.fetchPolicySummary(this.taskResult.policyDecisionId)
      }
    } catch (e: unknown) {
      this.commandExecutionError = formatBffError(e, '操作执行失败')
    } finally {
      this.loading = false
    }
  }

  async fetchPolicySummary(decisionId: string) {
    this.policySummaryError = null
    try {
      this.policySummary = (await fetchPolicySummary(this.token, decisionId)).decision
    } catch (e: unknown) {
      this.policySummary = null
      this.policySummaryError = formatBffError(e, '策略摘要加载失败')
    }
  }
}

export const appState = new AppState()
