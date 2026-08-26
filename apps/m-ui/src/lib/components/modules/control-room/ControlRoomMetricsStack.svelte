<script lang="ts">
  import type { AuditEntry, OverviewData } from '$lib/types.ts'
  import { formatTime, truncateId } from './control-room-display-format.ts'

  /**
   * Zone 边界：密集只读账本与服务表格区，服务「Traceability」体验层。
   *
   * 归属：M-UI 拥有表格结构与列顺序。Timeline 条目由 M-Log 拥有，
   * Audit 事实由 M-Log Audit 边界拥有，服务运行态由各功能域服务上报，
   * 全部经 M-UI BFF 适配后作为显式 props 传入。本组件只做展示层归并、
   * 排序与截断，不产生事实、不改写结果、不做授权判断。
   */
  type Props = {
    timeline: OverviewData['timeline']
    auditEntries: AuditEntry[] | null
    services: OverviewData['services']
  }

  let { timeline, auditEntries, services }: Props = $props()

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
    if (timeline) {
      for (const entry of timeline.slice(0, 40)) {
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
        const source = actionParts[0]
          ? actionParts[0].charAt(0).toUpperCase() + actionParts[0].slice(1)
          : 'Audit'
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

  /** 把服务运行模式映射为信号色 token；纯展示映射。 */
  function serviceHealthColor(mode: string | undefined): string {
    if (mode === 'normal') return 'var(--signal-ok)'
    if (mode === 'degraded') return 'var(--signal-warn)'
    return 'var(--text-40)'
  }

  /**
   * 从服务 domain 派生用于展示的内部 endpoint 字符串。
   * 这是过渡工作台的展示层近似值，不是服务注册事实来源；
   * 权威 endpoint 仍归属服务注册与运维契约。
   */
  function serviceEndpoint(domain: string, id: string): string {
    const host =
      domain === 'core' ? 'core.internal' : `${domain.replace('m-', 'm').replace('-', '')}.internal`
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

  /** 把 stateSource 机器标识映射为中文可读标签；机器字段本身保持英文。 */
  function stateSourceLabel(source: string): string {
    const map: Record<string, string> = {
      authoritative: '权威',
      'read-model': '读模型',
      eventBusMetrics: '事件总线指标',
      timeline: '时间线',
      audit: '审计',
      cache: '缓存'
    }
    return map[source] ?? source
  }
</script>

<div class="metrics-stack" data-testid="control-room-metrics-panel">
  <section class="zone-panel ledger-zone" aria-labelledby="ledger-title">
    <div class="zone-header">
      <div class="zone-titles">
        <span class="zone-eyebrow">Event &amp; Audit stream</span>
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
      <span class="zone-count">{services.length}</span>
    </div>
    {#if services.length === 0}
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
            {#each services as svc}
              <tr>
                <td class="mono cell-wrap">{svc.id}</td>
                <td>
                  <span
                    class="status-dot"
                    style="background: {serviceHealthColor(svc.runtime?.mode)}"
                  ></span>
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

<style>
  .metrics-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
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

  .table-wrap {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  /* 账本区限制高度并独立滚动，避免长事件流把服务表格推出视口。 */
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

  .empty-copy {
    color: var(--text-40);
    font-size: var(--text-sm);
  }

  .mono {
    font-family: var(--font-mono);
  }
</style>
