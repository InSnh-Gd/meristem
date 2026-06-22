<script lang="ts">
  import type { EventBusSubjectMetric } from '$lib/types.ts'

  type Props = {
    subjects: readonly EventBusSubjectMetric[]
  }

  let { subjects }: Props = $props()

  // ponytail: Proportional stacked-bar chart rendered with native HTML/CSS — no chart library.
  // Bounded pilot for the operator question:
  //   "Is any EventBus subject trending toward rejection or failure disproportionately
  //    to its success volume?"
  // One row per subject. Status is never communicated by color alone — each row always
  // shows numeric counts with Chinese labels. If subjects is empty, a visible text empty
  // state is rendered; the parent is responsible for the null-metrics case.
  type RowShape = {
    successPct: number
    rejectedPct: number
    failedPct: number
    total: number
  }

  function computeRow(metric: EventBusSubjectMetric): RowShape {
    const total = metric.success + metric.rejected + metric.failed
    if (total === 0) {
      return { successPct: 0, rejectedPct: 0, failedPct: 0, total: 0 }
    }
    return {
      successPct: (metric.success / total) * 100,
      rejectedPct: (metric.rejected / total) * 100,
      failedPct: (metric.failed / total) * 100,
      total
    }
  }
</script>

{#if subjects.length === 0}
  <p class="chart-empty" data-testid="eventbus-chart-empty">当前窗口内没有发布 subject 指标。</p>
{:else}
  <ul class="subject-health-chart" role="list" data-testid="eventbus-chart" aria-label="EventBus 各 subject 发布健康分布">
    {#each subjects.slice(0, 8) as metric (metric.subject)}
      {@const row = computeRow(metric)}
      <li
        class="chart-row"
        aria-label="{metric.subject}: 成功 {metric.success}, 拒绝 {metric.rejected}, 失败 {metric.failed}"
      >
        <span class="subject-label mono" data-testid="eventbus-chart-subject">{metric.subject}</span>
        {#if row.total === 0}
          <span class="chart-empty-bar" aria-hidden="true">无数据</span>
          <span class="counts mono">成功 0 · 拒绝 0 · 失败 0</span>
        {:else}
          <div class="bar" aria-hidden="true">
            {#if row.successPct > 0}
              <div class="bar-seg bar-ok" style="width: {row.successPct}%"></div>
            {/if}
            {#if row.rejectedPct > 0}
              <div class="bar-seg bar-warn" style="width: {row.rejectedPct}%"></div>
            {/if}
            {#if row.failedPct > 0}
              <div class="bar-seg bar-danger" style="width: {row.failedPct}%"></div>
            {/if}
          </div>
          <span class="counts mono" data-testid="eventbus-chart-counts"
            >成功 {metric.success} · 拒绝 {metric.rejected} · 失败 {metric.failed}</span
          >
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .chart-empty {
    color: var(--text-40);
    font-size: var(--text-sm);
    padding: var(--space-2) 0;
  }

  .subject-health-chart {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .chart-row {
    display: grid;
    grid-template-columns: minmax(140px, 0.9fr) minmax(180px, 1.4fr) auto;
    gap: var(--space-3);
    align-items: center;
    font-size: var(--text-sm);
  }

  .subject-label {
    color: var(--text-100);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    display: flex;
    height: 10px;
    width: 100%;
    background: var(--surface-sunken);
    border: 1px solid var(--line-soft);
    border-radius: 2px;
    overflow: hidden;
  }

  .bar-seg {
    height: 100%;
    display: block;
  }

  /* ponytail: status communicated by segment + always-visible numeric counts, never color alone. */
  .bar-ok {
    background: var(--signal-ok);
  }
  .bar-warn {
    background: var(--signal-warn);
  }
  .bar-danger {
    background: var(--signal-block);
  }

  .chart-empty-bar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 10px;
    width: 100%;
    color: var(--text-40);
    font-size: var(--text-xs);
    border: 1px dashed var(--line-soft);
    border-radius: 2px;
  }

  .counts {
    color: var(--text-80);
    font-size: var(--text-xs);
    white-space: nowrap;
  }

  @media (max-width: 760px) {
    .chart-row {
      grid-template-columns: 1fr;
      align-items: stretch;
      gap: var(--space-1);
    }
    .subject-label,
    .counts {
      font-size: var(--text-xs);
    }
  }
</style>
