<script lang="ts">
  import type { OverviewData, PolicyDecisionSummary } from '$lib/types.ts'
  import { formatTime, truncateId } from './control-room-display-format.ts'
  import { SUMMARY_ICONS } from './control-room-summary-icons.ts'

  /**
   * Zone 边界：系统状态摘要卡片区，服务「Orientation」体验层。
   *
   * 归属：M-UI 拥有这一区域的结构与展示；卡片上的每一项事实都由
   * M-* 功能域服务产生并经 M-UI BFF 适配后作为显式 props 传入。
   * 本组件不订阅 store、不发起数据获取、不做授权或策略判断，
   * stateSource 标注只是把上游已声明的来源可见化。
   */
  type Props = {
    coreMode: OverviewData['core']['mode']
    coreVersion: string
    eventBusMetrics: OverviewData['eventBusMetrics']
    reachableNodeCount: number
    totalNodeCount: number
    selectedNodeName: string | null
    policySummary: PolicyDecisionSummary | null
    auditAccessible: boolean
    forcedRelaySummary: string
    eventStreamLastEventAt: string | undefined
  }

  let {
    coreMode,
    coreVersion,
    eventBusMetrics,
    reachableNodeCount,
    totalNodeCount,
    selectedNodeName,
    policySummary,
    auditAccessible,
    forcedRelaySummary,
    eventStreamLastEventAt
  }: Props = $props()
</script>

<section class="zone-panel summary-zone" aria-labelledby="summary-title">
  <h2 id="summary-title" class="zone-title">系统状态</h2>
  <div class="summary-card-grid">
    <article class="summary-card core-health">
      <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.core}</div>
      <div class="summary-card-main">
        <div class="summary-card-title">Core Health</div>
        <div class="summary-card-value {coreMode === 'normal' ? '' : 'degraded'}">
          {coreMode === 'normal' ? 'healthy' : coreMode}
        </div>
        <div class="summary-card-chips">
          <span class="meta-chip">stateSource: authoritative</span>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="summary-card-footer-left">更新: {formatTime(new Date().toISOString())}</span>
        <span class="summary-card-footer-right" title="trace">trace: cor_{coreVersion}</span>
      </div>
    </article>

    <article class="summary-card event-bus">
      <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.event}</div>
      <div class="summary-card-main">
        <div class="summary-card-title">EventBus</div>
        <div
          class="summary-card-value {eventBusMetrics &&
          eventBusMetrics.totals.failed + eventBusMetrics.totals.rejected > 0
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
          {reachableNodeCount} / {totalNodeCount} reachable
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
          {policySummary?.result ?? '—'}
        </div>
        <div class="summary-card-chips">
          <span class="meta-label">last decision:</span>
          <span class="meta-chip state-allow">{policySummary?.result ?? '—'}</span>
        </div>
      </div>
      <div class="summary-card-footer">
        <span class="summary-card-footer-left">更新: {policySummary ? formatTime(policySummary.createdAt) : '—'}</span>
        <span class="summary-card-footer-right">stateSource: read-model</span>
      </div>
    </article>

    <article class="summary-card audit-visibility">
      <div class="summary-card-glow-icon" aria-hidden="true">{@html SUMMARY_ICONS.audit}</div>
      <div class="summary-card-main">
        <div class="summary-card-title">Audit Visibility</div>
        <div class="summary-card-value">
          {auditAccessible ? 'granted' : 'denied'}
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
        <span class="summary-card-footer-left">更新: {eventStreamLastEventAt ? formatTime(eventStreamLastEventAt) : '—'}</span>
        <span class="summary-card-footer-right">route: forced_relay.change.v0</span>
      </div>
    </article>
  </div>
</section>

<style>
  /* zone 自身的内边距；卡片与 chip 视觉由 app.css 的共享 workbench 样式提供。 */
  .summary-zone {
    padding: var(--space-3);
  }
</style>
