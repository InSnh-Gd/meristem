<script lang="ts">
  import { onMount } from 'svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import DecisionQueueSummary from '$lib/components/modules/policy/DecisionQueueSummary.svelte'
  import PolicyDecisionPanel from '$lib/components/modules/policy/PolicyDecisionPanel.svelte'
  import { appState } from '$lib/stores.svelte.ts'

  const resultLabel: Record<string, string> = {
    allow: '允许',
    deny: '拒绝',
    require_manual_review: '待人工审核',
    require_multi_approval: '待多重审批'
  }

  const resultTone: Record<string, string> = {
    allow: 'ok',
    deny: 'block',
    require_manual_review: 'warn',
    require_multi_approval: 'audit'
  }

  const decisions = $derived(appState.policyDecisions?.decisions ?? [])
  const pendingCount = $derived(decisions.filter((decision) => [
    'require_manual_review',
    'require_multi_approval'
  ].includes(decision.result)).length)

  function getResultLabel(result: string) {
    return resultLabel[result] ?? result
  }

  function getResultTone(result: string) {
    return resultTone[result] ?? 'info'
  }

  onMount(() => {
    void appState.fetchPolicyDecisions()
  })
</script>

<section class="route-page" aria-labelledby="policy-decisions-title">
  <RouteHeader routeName="策略决策" stateSources={['policy', 'audit']} />
  <div class="title-row">
    <div>
      <h2 id="policy-decisions-title" class="section-title">策略决策队列</h2>
      <p class="section-copy">展示 M-Policy 决策结果，并保留可审计的决策编号。</p>
    </div>
    <DecisionQueueSummary {pendingCount} />
  </div>

  <div class="panel">
    {#if decisions.length === 0}
      <p class="empty-state">暂无策略决策</p>
    {:else}
      <PolicyDecisionPanel {decisions} />
    {/if}
  </div>

  <section class="panel detail-panel" aria-label="策略决策详情">
    <h3>决策结果</h3>
    {#if decisions.length === 0}
      <p class="empty-state">没有可展示的决策详情</p>
    {:else}
      <div class="decision-list">
        {#each decisions as decision}
          <article class="decision-card" data-result={getResultTone(decision.result)}>
            <div class="decision-card-header">
              <span class="decision-id">{decision.id}</span>
              <span class="decision-result">{getResultLabel(decision.result)}</span>
            </div>
            <dl class="decision-meta">
              <div>
                <dt>操作者</dt>
                <dd>{decision.actor}</dd>
              </div>
              <div>
                <dt>动作</dt>
                <dd>{decision.action}</dd>
              </div>
              <div>
                <dt>资源</dt>
                <dd>{decision.resource}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{new Date(decision.createdAt).toLocaleString('zh-CN')}</dd>
              </div>
            </dl>
            {#if decision.reasons.length > 0}
              <ul class="reason-list" aria-label="决策原因">
                {#each decision.reasons as reason}
                  <li>{reason}</li>
                {/each}
              </ul>
            {/if}
          </article>
        {/each}
      </div>
    {/if}
  </section>
</section>

<style>
  .route-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    color: var(--text-100);
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .section-title {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .section-copy,
  .empty-state {
    color: var(--text-100);
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .detail-panel h3 {
    color: var(--signal-info);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .decision-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .decision-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid var(--line-soft);
    padding: var(--space-3);
  }

  .decision-card[data-result='ok'] {
    border-color: var(--signal-ok);
  }

  .decision-card[data-result='block'] {
    border-color: var(--signal-block);
  }

  .decision-card[data-result='warn'] {
    border-color: var(--signal-warn);
  }

  .decision-card[data-result='audit'] {
    border-color: var(--signal-audit);
  }

  .decision-card[data-result='info'] {
    border-color: var(--signal-info);
  }

  .decision-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .decision-id,
  .decision-meta dd,
  .reason-list {
    font-family: var(--font-mono);
  }

  .decision-id {
    color: var(--text-100);
    font-size: var(--text-xs);
  }

  .decision-result {
    color: var(--text-100);
    font-size: var(--text-xs);
    font-weight: var(--fw-semibold);
  }

  .decision-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .decision-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .decision-meta dt {
    color: var(--text-100);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
  }

  .decision-meta dd {
    color: var(--text-100);
    font-size: var(--text-xs);
    line-height: var(--lh-log);
    margin: 0;
  }

  .reason-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    color: var(--text-100);
    font-size: var(--text-xs);
    line-height: var(--lh-log);
    margin: 0;
    padding-left: var(--space-4);
  }

  @media (max-width: 760px) {
    .title-row,
    .decision-card-header {
      flex-direction: column;
    }

    .decision-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
