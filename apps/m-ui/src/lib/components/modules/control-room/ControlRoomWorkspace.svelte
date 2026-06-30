<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import type { OverviewData, AuditEntry } from '$lib/types.ts'

  // Inline SVG icon family for summary and preview cards.
  // Icons use a 24x24 viewBox, thicker strokes, and filled accents
  // so they remain recognizable at screenshot scale.
  const SUMMARY_ICONS: Record<string, string> = {
    core:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.1"/><path d="M4 12h3l2.5-5 3.5 9 2.5-5H20"/></svg>',
    event:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M16 8a6 6 0 0 1 0 8M8 8a6 6 0 0 0 0 8M19.5 5a9.5 9.5 0 0 1 0 14M4.5 5a9.5 9.5 0 0 0 0 14"/></svg>',
    node:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20c-4.5 0-8-3.5-8-8 0-5.5 4.5-9.5 8-11 3.5 1.5 8 5.5 8 11 0 4.5-3.5 8-8 8z" fill="currentColor" fill-opacity="0.12"/><path d="M12 6v14"/></svg>',
    policy:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.5 4v6.5c0 5.5-3.5 8.5-8.5 10.5-5-2-8.5-5-8.5-10.5V6.5l8.5-4z" fill="currentColor" fill-opacity="0.18"/><path d="m9 12 2.5 2.5L16 10"/></svg>',
    audit:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5c-5 0-9 3.5-9 7s4 7 9 7 9-3.5 9-7-4-7-9-7z" fill="currentColor" fill-opacity="0.12"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M20 12h1.5"/></svg>',
    preview:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 22 7v10l-10 5-10-5V7l10-5z" fill="currentColor" fill-opacity="0.1"/></svg>'
  }

  const overview = $derived(appState.overview)
  const eventBusMetrics = $derived(appState.overview?.eventBusMetrics ?? null)
  const auditEntries: AuditEntry[] | null = $derived(appState.auditEntries)

  const dependencySummary = $derived.by(() => {
    if (!overview) return { ready: 0, total: 0 }
    const entries = Object.entries(overview.dependencies)
    return {
      ready: entries.filter(([, state]) => state === 'ready').length,
      total: entries.length
    }
  })

  const degradedState = $derived.by(() => {
    if (!overview) return null
    if (overview.core.mode !== 'normal') return `Core 当前处于 ${overview.core.mode} 模式`
    const unavailable = Object.entries(overview.dependencies)
      .filter(([, state]) => state !== 'ready')
      .map(([name]) => name)
    if (unavailable.length > 0) return `依赖不可用：${unavailable.join('、')}`
    return null
  })

  const nodeCounts = $derived.by(() => {
    if (!overview) return { total: 0, reachable: 0, leaf: 0 }
    const leaf = overview.nodes.filter((n) => n.kind === 'leaf').length
    const reachable = overview.nodes.filter(
      (n) => n.reachability === 'reachable' || n.reachability === 'public'
    ).length
    return { total: overview.nodes.length, reachable, leaf }
  })

  const selectedNodeName = $derived(appState.selectedNode?.name ?? null)
  const forcedRelaySummary = $derived.by(() => {
    const state = appState.operationalState?.forcedRelay
    if (!state) return 'forced relay 状态未加载'
    if (!state.active) return 'Forced relay 未激活'
    return `${state.routeClass ?? 'forced-tcp-relay'} · ${state.affectedNodeIds.length} nodes`
  })
  const taskResultTaskId = $derived.by(() => {
    const result = appState.taskResult
    return result && 'task' in result ? result.task.id : '—'
  })
  const taskResultTaskStatus = $derived.by(() => {
    const result = appState.taskResult
    return result && 'task' in result ? result.task.status : '—'
  })

  function formatTime(ts: string | undefined): string {
    if (!ts) return '—'
    try {
      return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false })
    } catch {
      return '—'
    }
  }

  function nodeStatusColor(status: OverviewData['nodes'][number]['status']): string {
    if (status === 'healthy' || status === 'ready') return 'var(--signal-ok)'
    if (status === 'degraded' || status === 'recovering') return 'var(--signal-warn)'
    if (status === 'offline' || status === 'disabled' || status === 'revoked') return 'var(--signal-block)'
    if (status === 'joining') return 'var(--signal-info)'
    if (status === 'isolated') return 'var(--signal-risk)'
    return 'var(--text-40)'
  }

  function serviceHealthColor(mode: string | undefined): string {
    if (mode === 'normal') return 'var(--signal-ok)'
    if (mode === 'degraded') return 'var(--signal-warn)'
    return 'var(--text-40)'
  }

  function serviceEndpoint(domain: string, id: string): string {
    const host = domain === 'core' ? 'core.internal' : `${domain.replace('m-', 'm').replace('-', '')}.internal`
    const portMap: Record<string, string> = {
      core: '8443',
      'm-ui': '8080',
      'm-task': '8081',
      'm-policy': '8082',
      'm-log': '8083',
      'm-net': '8084',
      'm-eventbus': '8092',
      'm-cli': '—',
      'm-extension': '8085'
    }
    return `${host}:${portMap[domain] ?? '—'}`
  }

  type LedgerRow = {
    id: string
    timestamp: string
    event: string
    actor: string
    target: string
    source: string
    policyDecisionId?: string
    correlationId?: string
    outcome: string
    outcomeClass: string
  }

  const ledgerRows = $derived.by((): LedgerRow[] => {
    const rows: LedgerRow[] = []
    if (overview?.timeline) {
      for (const entry of overview.timeline.slice(0, 40)) {
        rows.push({
          id: `tl-${entry.id}`,
          timestamp: entry.timestamp,
          event: entry.summary,
          actor: 'system',
          target: entry.subject ?? '—',
          source: 'Timeline',
          correlationId: entry.correlationId,
          outcome: 'logged',
          outcomeClass: 'info'
        })
      }
    }
    if (auditEntries) {
      for (const entry of auditEntries.slice(0, 40)) {
        const actionParts = entry.action.split('.')
        const source = actionParts[0] ? actionParts[0].charAt(0).toUpperCase() + actionParts[0].slice(1) : 'Audit'
        const outcomeClass =
          entry.result === 'allow' || entry.result === 'allowed'
            ? 'ok'
            : entry.result === 'deny' || entry.result === 'denied'
              ? 'block'
              : entry.result === 'recorded'
                ? 'info'
                : 'warn'
        rows.push({
          id: `au-${entry.id}`,
          timestamp: entry.timestamp,
          event: entry.action,
          actor: entry.actor,
          target: entry.resource,
          source,
          policyDecisionId: auditField(entry, 'decisionId'),
          correlationId: auditField(entry, 'correlationId'),
          outcome: entry.result,
          outcomeClass
        })
      }
    }
    return rows
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 24)
  })

  function auditField(entry: AuditEntry, key: 'decisionId' | 'correlationId'): string | undefined {
    // overview.audit 使用简化的 AuditEntry，而 fetchAudit() 返回完整的 WithStateSource<AuditLog>。
    // 两者在运行时都可能存在该字段，因此通过 key-in 检查安全读取。
    if (key in entry) {
      const value = (entry as AuditEntry & Record<string, unknown>)[key]
      return typeof value === 'string' ? value : undefined
    }
    return undefined
  }

  function stateSourceLabel(source: string): string {
    const map: Record<string, string> = {
      authoritative: '权威',
      'read-model': '读模型',
      'eventBusMetrics': '事件总线指标',
      'timeline': '时间线',
      'audit': '审计',
      'cache': '缓存'
    }
    return map[source] ?? source
  }

  function selectNode(nodeId: string) {
    void appState.selectNode(nodeId)
  }

  function truncateId(value: string | undefined, limit = 16): string {
    if (!value) return '—'
    return value.length > limit ? `${value.slice(0, limit)}…` : value
  }

  const previewSummaryCards = [
    { title: 'Core Health', icon: SUMMARY_ICONS.core, cardClass: 'core-health' },
    { title: 'EventBus', icon: SUMMARY_ICONS.event, cardClass: 'event-bus' },
    { title: 'Leaf Nodes', icon: SUMMARY_ICONS.node, cardClass: 'leaf-nodes' },
    { title: 'Policy Gate', icon: SUMMARY_ICONS.policy, cardClass: 'policy-gate' },
    { title: 'Audit Visibility', icon: SUMMARY_ICONS.audit, cardClass: 'audit-visibility' }
  ]

  const previewCommandCards = [
    { title: '运行 noop 任务', icon: SUMMARY_ICONS.core },
    { title: '刷新 Leaf 状态', icon: SUMMARY_ICONS.node },
    { title: '查看 EventBus publish summary', icon: SUMMARY_ICONS.event },
    { title: '运行 重启任务', icon: SUMMARY_ICONS.policy }
  ]

  onMount(() => {
    void appState.fetchRoutes()
    void appState.refresh()
  })
</script>

<svelte:head>
  <title>控制室概览 | Meristem</title>
</svelte:head>

<div class="control-room-page">
  {#if degradedState}
    <InlineOperationalAlert message={degradedState} severity="warn" />
  {/if}

  {#if overview}
    <div class="control-room-layout">
      <div class="workspace-zones">
        <!-- Title block -->
        <header class="page-title-block">
          <div class="page-titles">
            <h2 class="page-eyebrow">控制室概览</h2>
            <h1 class="page-title">控制室总览</h1>
            <p class="page-subtitle">观察 Core、功能域服务、Leaf 节点、策略、任务与审计状态。</p>
          </div>
          <div class="page-meta">
            <span class="status-badge">actor: {appState.actor ?? '—'}</span>
            <span class="status-badge">core: {overview.core.mode}</span>
            <span class="status-badge ready">控制面就绪</span>
          </div>
        </header>

        <!-- Summary cards -->
        <section class="zone-panel summary-zone" aria-labelledby="summary-title">
          <h2 id="summary-title" class="zone-title">系统状态</h2>
          <div class="summary-card-grid">
            <article class="summary-card core-health">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.core}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">Core Health</div>
                <div class="summary-card-value {overview.core.mode === 'normal' ? '' : 'degraded'}">
                  {overview.core.mode === 'normal' ? 'healthy' : overview.core.mode}
                </div>
                <div class="summary-card-chips">
                  <span class="meta-chip">stateSource: authoritative</span>
                </div>
              </div>
              <div class="summary-card-footer">
                <span class="summary-card-footer-left">更新: {formatTime(new Date().toISOString())}</span>
                <span class="summary-card-footer-right" title="trace">trace: cor_{overview.core.version}</span>
              </div>
            </article>

            <article class="summary-card event-bus">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.event}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">EventBus</div>
                <div
                  class="summary-card-value {eventBusMetrics && eventBusMetrics.totals.failed + eventBusMetrics.totals.rejected > 0
                    ? 'has-issues'
                    : ''}"
                >
                  {#if eventBusMetrics}
                    {eventBusMetrics.totals.rejected} 拒绝 · {eventBusMetrics.totals.failed} 失败 · {eventBusMetrics.totals.success} 成功
                  {:else}
                    —
                  {/if}
                </div>
                <div class="summary-card-chips">
                  <span class="meta-chip">source: eventBusMetrics</span>
                </div>
              </div>
              <div class="summary-card-footer">
                <span class="summary-card-footer-left">更新: {eventBusMetrics ? formatTime(eventBusMetrics.generatedAt) : '—'}</span>
                <span class="summary-card-footer-right" title="trace">trace: {eventBusMetrics ? truncateId(eventBusMetrics.service, 12) : '—'}</span>
              </div>
            </article>

            <article class="summary-card leaf-nodes">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.node}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">Leaf Nodes</div>
                <div class="summary-card-value">
                  {nodeCounts.reachable} / {nodeCounts.total} reachable
                </div>
                <div class="summary-card-chips">
                  <span class="meta-chip">selected: {selectedNodeName ?? 'leaf-cn-01'}</span>
                </div>
              </div>
              <div class="summary-card-footer">
                <span class="summary-card-footer-left">更新: {formatTime(new Date().toISOString())}</span>
                <span class="summary-card-footer-right">stateSource: read-model</span>
              </div>
            </article>

            <article class="summary-card policy-gate">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.policy}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">Policy Gate</div>
                <div class="summary-card-value">
                  {appState.policySummary?.result ?? '—'}
                </div>
                <div class="summary-card-chips">
                  <span class="meta-label">last decision:</span>
                  <span class="meta-chip state-allow">{appState.policySummary?.result ?? '—'}</span>
                </div>
              </div>
              <div class="summary-card-footer">
                <span class="summary-card-footer-left">更新: {appState.policySummary ? formatTime(appState.policySummary.createdAt) : '—'}</span>
                <span class="summary-card-footer-right">stateSource: read-model</span>
              </div>
            </article>

            <article class="summary-card audit-visibility">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.audit}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">Audit Visibility</div>
                <div class="summary-card-value">
                  {overview.auditAccessible ? 'granted' : 'denied'}
                </div>
                <div class="summary-card-chips">
                  <span class="meta-chip">audit:read</span>
                </div>
              </div>
              <div class="summary-card-footer">
                <span class="summary-card-footer-left">更新: {formatTime(new Date().toISOString())}</span>
                <span class="summary-card-footer-right">stateSource: read-model</span>
              </div>
            </article>

            <article class="summary-card event-bus">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.preview}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">Forced Relay</div>
                <div class="summary-card-value">{forcedRelaySummary}</div>
                <div class="summary-card-chips">
                  <span class="meta-chip">stateSource: read-model</span>
                </div>
              </div>
              <div class="summary-card-footer">
                <span class="summary-card-footer-left">更新: {appState.operationalState?.eventStream.lastEventAt ? formatTime(appState.operationalState.eventStream.lastEventAt) : '—'}</span>
                <span class="summary-card-footer-right">route: forced_relay.change.v0</span>
              </div>
            </article>
          </div>
        </section>

        <!-- CommandWell -->
        <section
          class="zone-panel command-zone"
          aria-labelledby="command-title"
          data-testid="control-room-quick-actions"
        >
          <div class="zone-header">
            <div class="zone-titles">
              <h2 class="zone-eyebrow">命令中心</h2>
              <h2 id="command-title">CommandWell · 受控操作井</h2>
            </div>
            <div class="command-context">
              执行上下文: {selectedNodeName ?? '—'}
            </div>
          </div>
          <CommandWell
            commandState={appState.commandState}
            commandStateError={appState.commandStateError}
            commandExecutionError={appState.commandExecutionError}
            selectedNode={appState.selectedNode}
            taskResult={appState.taskResult}
            confirming={appState.commandConfirming}
            onRequestConfirm={() => (appState.commandConfirming = true)}
            onCancel={() => (appState.commandConfirming = false)}
            onConfirm={async () => {
              if (appState.commandState?.command?.id === 'network.forced-relay.change.execute') {
                appState.commandParams = {
                  nodeId: appState.selectedNodeId,
                  reason: 'Control Room forced relay change'
                }
              } else {
                appState.commandParams = { leafNodeId: appState.selectedNodeId }
              }
              await appState.executeGenericCommand()
              void appState.refresh()
              if (appState.operationalState?.networkId) {
                void appState.fetchOperationalState(appState.operationalState.networkId)
              }
            }}
          />
        </section>

        <!-- Node selector strip -->
        <section
          class="zone-panel node-selector-zone"
          data-testid="control-room-operations-panel"
          aria-labelledby="nodes-title"
        >
          <div class="zone-header">
            <div class="zone-titles">
              <span class="zone-eyebrow">Node inventory</span>
              <h2 id="nodes-title">节点</h2>
            </div>
            <span class="zone-count">{overview.nodes.length}</span>
          </div>
          {#if overview.nodes.length === 0}
            <p class="empty-copy">暂无节点</p>
          {:else}
            <div class="node-selector-strip">
              {#each overview.nodes as node}
                <button
                  class="node-chip"
                  class:selected={node.id === appState.selectedNodeId}
                  onclick={() => selectNode(node.id)}
                  data-testid="node-chip-{node.name}"
                  type="button"
                >
                  <span class="status-dot" style="background: {nodeStatusColor(node.status)}"></span>
                  <span class="node-chip-name">{node.name}</span>
                  <span class="node-chip-kind">{node.kind}</span>
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <!-- Dense ledger and service tables -->
        <div class="metrics-stack" data-testid="control-room-metrics-panel">
          <section class="zone-panel ledger-zone" aria-labelledby="ledger-title">
            <div class="zone-header">
              <div class="zone-titles">
                <span class="zone-eyebrow">Event & Audit stream</span>
                <h2 id="ledger-title">事件与审计账本</h2>
              </div>
              <span class="zone-count">{ledgerRows.length}</span>
            </div>
            <div data-testid="control-room-recent-activity-panel">
              {#if ledgerRows.length === 0}
                <p class="empty-copy">暂无日志条目</p>
              {:else}
                <div class="table-wrap ledger-wrap">
                  <table class="ledger-table">
                    <thead>
                      <tr>
                        <th>timestamp</th>
                        <th>event</th>
                        <th>actor</th>
                        <th>target</th>
                        <th>source</th>
                        <th>policyDecisionId</th>
                        <th>correlationId</th>
                        <th>outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each ledgerRows as row}
                        <tr title={row.correlationId ? `correlation: ${row.correlationId}` : undefined}>
                          <td class="mono">{formatTime(row.timestamp)}</td>
                          <td class="cell-wrap">{row.event}</td>
                          <td class="mono cell-wrap">{row.actor}</td>
                          <td class="mono cell-wrap">{row.target}</td>
                          <td class="mono">{row.source}</td>
                          <td class="mono cell-wrap">{truncateId(row.policyDecisionId, 18)}</td>
                          <td class="mono cell-wrap">{truncateId(row.correlationId, 18)}</td>
                          <td class="ledger-outcome {row.outcomeClass}">{row.outcome}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {/if}
            </div>
          </section>

          <section class="zone-panel service-zone" aria-labelledby="services-title">
            <div class="zone-header">
              <div class="zone-titles">
                <span class="zone-eyebrow">Service map</span>
              <h2 id="services-title">功能域服务状态</h2>
              </div>
              <span class="zone-count">{overview.services.length}</span>
            </div>
            {#if overview.services.length === 0}
          <p class="empty-copy">暂无功能域服务</p>
            {:else}
              <div class="table-wrap">
                <table class="service-map-table">
                  <thead>
                    <tr>
                      <th>service</th>
                      <th>health</th>
                      <th>stateSource</th>
                      <th>endpoint / port</th>
                      <th>last check</th>
                      <th>uptime</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each overview.services as svc}
                      <tr>
                        <td class="mono cell-wrap">{svc.id}</td>
                        <td>
                          <span class="status-dot" style="background: {serviceHealthColor(svc.runtime?.mode)}"></span>
                          {svc.runtime?.mode ?? 'unknown'}
                        </td>
                        <td>
                          read-model
                          <span class="state-source-cn">{stateSourceLabel('read-model')}</span>
                        </td>
                        <td class="mono">{serviceEndpoint(svc.domain, svc.id)}</td>
                        <td class="mono">{formatTime(svc.runtime?.lastReloadedAt)}</td>
                        <td class="mono">—</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
          </section>
        </div>
      </div>

      <aside class="inspector-panel zone-panel" aria-label="已选上下文">
        <div class="inspector-header">
          <div class="zone-titles">
            <span class="zone-eyebrow">Selected Context</span>
            <h2>{appState.selectedNode?.name ?? '未选择节点'}</h2>
          </div>
          {#if appState.selectedNodeId}
            <span class="status-badge">{appState.selectedNode?.status ?? '—'}</span>
          {/if}
        </div>

        {#if !appState.selectedNode}
          <div class="empty-copy inspector-empty">选择上方节点以查看上下文、策略与跟踪信息。</div>
        {:else}
          {@const node = appState.selectedNode}
          <div class="inspector-section">
            <span class="inspector-section-title">身份与权限</span>
            <div class="inspector-row">
              <span class="inspector-key">nodeKind</span>
              <span class="inspector-value">{node.kind}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">reachability</span>
              <span class="inspector-value">{node.reachability}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">actor</span>
              <span class="inspector-value">{appState.actor ?? '—'}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">permissions</span>
              <span class="inspector-value">{appState.permissions.join(' ') || '—'}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">stateSource</span>
              <span class="inspector-value">read-model</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">lastRefresh</span>
              <span class="inspector-value">{formatTime(new Date().toISOString())}</span>
            </div>
          </div>

          <div class="inspector-section">
            <span class="inspector-section-title">节点信息</span>
            <div class="inspector-row">
              <span class="inspector-key">nodeId</span>
              <span class="inspector-value">{truncateId(node.id, 22)}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">name</span>
              <span class="inspector-value">{node.name}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">mode</span>
              <span class="inspector-value">{node.mode}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">status</span>
              <span class="inspector-value">{node.status}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">lastSeenAt</span>
              <span class="inspector-value">{formatTime(node.lastSeenAt)}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">version</span>
              <span class="inspector-value">{node.agentVersion ?? '—'}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">capabilities</span>
              <span class="inspector-value">{node.capabilities.join(', ') || '—'}</span>
            </div>
          </div>

          <div class="inspector-section">
            <span class="inspector-section-title">策略上下文</span>
            <div class="inspector-row">
              <span class="inspector-key">lastDecision</span>
              <span class="inspector-value">{appState.policySummary?.result ?? '—'}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">policyDecisionId</span>
              <span class="inspector-value">{truncateId(appState.policySummary?.id, 22)}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">actor</span>
              <span class="inspector-value">{appState.policySummary?.actor ?? '—'}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">action</span>
              <span class="inspector-value">{appState.policySummary?.action ?? '—'}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">decisionAt</span>
              <span class="inspector-value">{formatTime(appState.policySummary?.createdAt)}</span>
            </div>
          </div>

          <div class="inspector-section">
            <span class="inspector-section-title">跟踪上下文</span>
            <div class="inspector-row">
              <span class="inspector-key">correlationId</span>
              <span class="inspector-value">{truncateId(appState.taskResult?.correlationId, 22)}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">task.id</span>
              <span class="inspector-value">{taskResultTaskId}</span>
            </div>
            <div class="inspector-row">
              <span class="inspector-key">task.status</span>
              <span class="inspector-value">{taskResultTaskStatus}</span>
            </div>
          </div>
        {/if}
      </aside>
    </div>
  {:else if !appState.loading}
    <div class="control-room-layout empty-workbench" aria-label="未授权控制室预览">
      <div class="workspace-zones">
        <header class="page-title-block">
          <div class="page-titles">
            <h2 class="page-eyebrow">控制室概览</h2>
            <h1 class="page-title">控制室总览</h1>
          <p class="page-subtitle">输入操作者令牌后加载 Core、功能域服务、Leaf 节点、策略与审计状态。</p>
          </div>
          <div class="page-meta">
            <span class="status-badge">actor: 未授权</span>
            <span class="status-badge">core: gated</span>
          </div>
        </header>

        <section class="zone-panel summary-zone" aria-labelledby="empty-summary-title">
          <h2 id="empty-summary-title" class="zone-title">系统状态</h2>
          <div class="summary-card-grid">
            {#each previewSummaryCards as card}
              <article class="summary-card preview-card {card.cardClass}">
                <div class="summary-card-glow-icon" aria-hidden="true">{@html card.icon}</div>
                <div class="summary-card-main">
                  <div class="summary-card-title">{card.title}</div>
                  <div class="summary-card-value preview-value">待加载</div>
                  <div class="summary-card-chips">
                    <span class="meta-chip">stateSource: gated</span>
                    <span class="meta-chip">需要令牌</span>
                  </div>
                </div>
                <div class="summary-card-footer">
                  <span class="summary-card-footer-left">更新: —</span>
                  <span class="summary-card-footer-right">gated</span>
                </div>
              </article>
            {/each}
          </div>
        </section>

        <section class="zone-panel command-zone" aria-labelledby="empty-command-title">
          <div class="zone-header">
            <div class="zone-titles">
              <h2 class="zone-eyebrow">命令中心</h2>
              <h2 id="empty-command-title">CommandWell · 受控操作井</h2>
            </div>
            <div class="command-context">执行上下文: gated</div>
          </div>
          <div class="command-deck preview-deck" aria-hidden="true">
            {#each previewCommandCards as card}
              <article class="command-card disabled preview-card">
                <div class="command-card-title">
                  <span class="command-card-icon">{@html card.icon}</span>
                  {card.title}
                </div>
                <div class="command-card-target">target: 需要令牌</div>
                <div class="command-card-requirements">
                  <span>requires: gated</span>
                  <span>policy: pending</span>
                  <span>audit: pending</span>
                </div>
                <div class="command-card-status block">状态: 未授权</div>
              </article>
            {/each}
          </div>
        </section>

        <div class="metrics-stack">
          <section class="zone-panel ledger-zone" aria-labelledby="empty-ledger-title">
            <div class="zone-header">
              <div class="zone-titles">
                <span class="zone-eyebrow">Event & Audit stream</span>
                <h2 id="empty-ledger-title">事件与审计账本</h2>
              </div>
              <span class="zone-count">0</span>
            </div>
            <div class="table-wrap preview-table">
              {#each Array(6) as _}
                <div class="preview-row"></div>
              {/each}
            </div>
          </section>

          <section class="zone-panel service-zone" aria-labelledby="empty-services-title">
            <div class="zone-header">
              <div class="zone-titles">
                <span class="zone-eyebrow">Service map</span>
            <h2 id="empty-services-title">功能域服务状态</h2>
              </div>
              <span class="zone-count">0</span>
            </div>
            <div class="table-wrap preview-table compact">
              {#each Array(5) as _}
                <div class="preview-row"></div>
              {/each}
            </div>
          </section>
        </div>
      </div>

      <aside class="inspector-panel zone-panel" aria-label="未授权上下文">
        <div class="inspector-header">
          <div class="zone-titles">
            <span class="zone-eyebrow">Selected Context</span>
            <h2>未选择节点</h2>
          </div>
        </div>
        <div class="empty-copy inspector-empty">请输入操作者令牌以加载控制室概览。</div>
        <div class="inspector-section">
          <span class="inspector-section-title">访问边界</span>
          <div class="inspector-row">
            <span class="inspector-key">stateSource</span>
            <span class="inspector-value">gated</span>
          </div>
          <div class="inspector-row">
            <span class="inspector-key">required</span>
            <span class="inspector-value">Bearer JWT</span>
          </div>
        </div>
      </aside>
    </div>
  {/if}
</div>

<style>
  .control-room-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .control-room-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--inspector-width);
    gap: var(--panel-gap);
    align-items: start;
  }

  .workspace-zones {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .page-title-block {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-1);
  }

  .page-title {
    color: var(--text-100);
    font-size: var(--text-2xl);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    letter-spacing: -0.01em;
  }

  .page-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.06em;
    margin: 0;
  }

  .page-subtitle {
    color: var(--text-60);
    font-size: var(--text-sm);
    margin-top: var(--space-1);
  }

  .page-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .zone-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .zone-title {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    letter-spacing: 0.01em;
    margin: 0;
  }

  .zone-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0;
  }

  .zone-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: var(--space-4);
    padding: 0 var(--space-1);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-pill);
    color: var(--text-60);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .summary-zone {
    padding: var(--space-3);
  }

  .command-zone {
    border-color: color-mix(in srgb, var(--signal-info) 24%, var(--line-soft));
  }

  .command-context {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line-soft);
    border-radius: var(--radius-pill);
    color: var(--text-60);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .metrics-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  .ledger-wrap {
    max-height: 32vh;
    overflow-y: auto;
  }

  .ledger-table tr,
  .service-map-table tr {
    cursor: default;
  }

  .ledger-outcome {
    font-weight: var(--fw-medium);
  }

  .ledger-outcome.ok {
    color: var(--signal-ok);
  }

  .ledger-outcome.warn {
    color: var(--signal-warn);
  }

  .ledger-outcome.block {
    color: var(--signal-block);
  }

  .ledger-outcome.info {
    color: var(--signal-info);
  }

  .status-dot {
    display: inline-block;
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-pill);
    margin-right: var(--space-1);
    vertical-align: middle;
  }

  .node-selector-zone {
    padding: var(--space-3);
  }

  .inspector-panel {
    position: sticky;
    top: var(--space-4);
    align-self: start;
    max-height: calc(100vh - var(--app-bar-height) - var(--space-6));
    min-width: 0;
    overflow-y: auto;
    padding: var(--space-3);
  }

  .inspector-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-2);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--line-soft);
    margin-bottom: var(--space-2);
  }

  .inspector-empty {
    padding: var(--space-4) 0;
  }

  .empty-copy {
    color: var(--text-40);
    font-size: var(--text-sm);
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .empty-workbench {
    opacity: 0.92;
  }

  .preview-card {
    color: var(--text-60);
  }

  .preview-value {
    color: var(--text-40);
  }

  .preview-table {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: var(--space-2);
    min-height: 132px;
  }

  .preview-table.compact {
    min-height: 112px;
  }

  .preview-row {
    height: 18px;
    border-bottom: 1px solid var(--line-soft);
    background: linear-gradient(90deg, color-mix(in srgb, var(--surface-raised) 45%, transparent), transparent 78%);
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 1200px) {
    .control-room-layout {
      grid-template-columns: 1fr;
    }

    .inspector-panel {
      position: static;
      max-height: none;
    }
  }

  @media (max-width: 960px) {
    .page-title-block {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
