<script lang="ts">
  const sourceConfig: Record<string, { label: string; color: string }> = {
    authoritative: { label: '权威', color: 'var(--signal-ok)' },
    event: { label: '事件', color: 'var(--text-60)' },
    cache: { label: '缓存', color: 'var(--signal-warn)' },
    'read-model': { label: '读模型', color: 'var(--signal-info)' },
    log: { label: '日志', color: 'var(--text-60)' },
    audit: { label: '审计', color: 'var(--signal-audit)' },
    policy: { label: '策略', color: 'var(--signal-block)' }
  }

  let { source } = $props<{ source: string }>()

  const badge = $derived(sourceConfig[source] ?? { label: source, color: 'var(--text-60)' })
</script>

<span class="state-source-badge" style:--badge-color={badge.color}>{badge.label}</span>

<style>
  .state-source-badge {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    border: 1px solid var(--badge-color);
    border-radius: var(--space-1);
    padding: 0 var(--space-1);
    color: var(--badge-color);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: var(--lh-tight);
    white-space: nowrap;
  }
</style>
