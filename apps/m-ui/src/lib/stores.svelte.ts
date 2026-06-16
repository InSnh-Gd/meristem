import {
  executeCommand,
  fetchApprovalDetail as fetchBffApprovalDetail,
  fetchApprovalQueue as fetchBffApprovalQueue,
  fetchAudit as fetchBffAudit,
  fetchNodes as fetchBffNodes,
  fetchNetworkProfileDetail as fetchBffNetworkProfileDetail,
  fetchNetworkProfiles as fetchBffNetworkProfiles,
  fetchPolicyDecisions as fetchBffPolicyDecisions,
  fetchRoutes as fetchBffRoutes,
  fetchServices as fetchBffServices,
  fetchTimeline as fetchBffTimeline,
  fetchCommandState,
  fetchOverview,
  fetchPolicySummary,
  formatBffError
} from './bff'
import type {
  ApprovalDetailResponseData,
  ApprovalQueueResponseData,
  AuditData,
  AuditEntry,
  CommandState,
  NetworkProfileDetailResponseData,
  NetworkProfileListResponseData,
  NodeListData,
  OverviewData,
  PolicyDecisionData,
  PolicyDecisionSummary,
  RouteRegistry,
  ServiceListData,
  TaskResult,
  TimelineData
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
  taskResult = $state<TaskResult | null>(null)
  commandConfirming = $state(false)
  policySummary = $state<PolicyDecisionSummary | null>(null)
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

  clearAudit() {
    this.audit = null
  }

  async selectNode(nodeId: string) {
    this.selectedNodeId = nodeId
    this.taskResult = null
    this.commandConfirming = false
    if (this.token && nodeId) {
      try {
        this.commandState = await fetchCommandState(this.token, nodeId)
      } catch {
        this.commandState = null
      }
    }
  }

  async confirmNoop() {
    if (!this.token || !this.selectedNodeId || this.commandState?.state !== 'enabled') return
    this.commandConfirming = false
    this.loading = true
    this.error = null
    try {
      this.taskResult = await executeCommand(this.token, 'task.noop.submit', {
        leafNodeId: this.selectedNodeId
      })
      await this.refresh()
      // 刷新后使用任务结果里的 policyDecisionId 拉取决策摘要
      if (this.taskResult?.policyDecisionId) {
        await this.fetchPolicySummary(this.taskResult.policyDecisionId)
      }
    } catch (e: unknown) {
      this.error = formatBffError(e, '任务执行失败')
    } finally {
      this.loading = false
    }
  }

  async fetchPolicySummary(decisionId: string) {
    try {
      this.policySummary = (await fetchPolicySummary(this.token, decisionId)).decision
    } catch {
      this.policySummary = null
    }
  }
}

export const appState = new AppState()
