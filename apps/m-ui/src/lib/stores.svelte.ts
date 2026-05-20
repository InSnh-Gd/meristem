import type { OverviewData, CommandState, TaskResult, PolicyDecisionSummary, AuditEntry } from './types'
import { fetchCommandState, fetchOverview, executeNoop, fetchPolicySummary, formatBffError } from './bff'

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

  get actor() { return this.overview?.session.actor ?? null }
  get permissions() { return this.overview?.session.permissions ?? [] }
  get auditEntries(): AuditEntry[] | null { return this.overview?.audit ?? null }
  get selectedNode() {
    if (!this.overview || !this.selectedNodeId) return null
    return this.overview.nodes.find((n) => n.id === this.selectedNodeId) ?? null
  }

  async refresh() {
    if (!this.token) return
    this.loading = true
    this.error = null
    try {
      this.overview = (await fetchOverview(this.token)) as OverviewData
    } catch (e: unknown) {
      this.error = formatBffError(e, '加载失败')
    } finally {
      this.loading = false
    }
  }

  async selectNode(nodeId: string) {
    this.selectedNodeId = nodeId
    this.taskResult = null
    this.commandConfirming = false
    if (this.token && nodeId) {
      try {
        this.commandState = (await fetchCommandState(this.token, nodeId)) as CommandState
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
      this.taskResult = (await executeNoop(this.token, this.selectedNodeId)) as TaskResult
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
      this.policySummary = (await fetchPolicySummary(this.token, decisionId)) as PolicyDecisionSummary
    } catch {
      this.policySummary = null
    }
  }
}

export const appState = new AppState()
