<script lang="ts">
  type Decision = { id: string; result: string }

  const resultConfig: Record<string, { label: string; color: string }> = {
    allow: { label: '允许', color: 'var(--signal-ok)' },
    deny: { label: '拒绝', color: 'var(--signal-block)' },
    require_manual_review: { label: '待人工审核', color: 'var(--signal-warn)' },
    require_multi_approval: { label: '待多重审批', color: 'var(--signal-audit)' }
  }

  let { decisions } = $props<{ decisions: Decision[] }>()

  function getResult(result: string) {
    return resultConfig[result] ?? { label: result, color: 'var(--text-60)' }
  }
</script>

<section class="policy-decision-panel" aria-label="策略决策结果">
  {#each decisions as decision}
    {@const result = getResult(decision.result)}
    <div class="decision-row" style:--decision-color={result.color}>
      <span class="decision-id">{decision.id}</span>
      <span class="decision-result">{result.label}</span>
    </div>
  {/each}
</section>

<style>
  .policy-decision-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .decision-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    background: var(--surface-sunken);
    padding: var(--space-2) var(--space-3);
  }

  .decision-id {
    color: var(--text-80);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .decision-result {
    color: var(--decision-color);
    font-size: var(--text-xs);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
  }
</style>
