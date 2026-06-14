import {
  executeCommand,
  fetchAudit as fetchBffAudit,
  fetchNodes as fetchBffNodes,
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
  AuditData,
  AuditEntry,
  CommandState,
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
  token = $state('')
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
