<script lang="ts">
  import { onMount } from 'svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import FilterBar from '$lib/components/layout/FilterBar.svelte'
  import AuditLedger from '$lib/components/modules/audit/AuditLedger.svelte'
  import RawEnvelopeView from '$lib/components/ui/RawEnvelopeView.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import type { AuditEntry } from '$lib/types.ts'

  let query = $state('')

  const auditEntries = $derived(appState.audit?.entries ?? null)
  const filteredEntries = $derived.by<AuditEntry[] | null>(() => {
    if (auditEntries === null) return null
    const normalized = query.trim().toLowerCase()
    const visibleEntries = auditEntries.map((entry) => ({
      id: entry.id,
      timestamp: entry.timestamp,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      result: entry.result
    }))
    if (!normalized) return visibleEntries
    return visibleEntries.filter((entry) => [
      entry.id,
      entry.timestamp,
      entry.actor,
      entry.action,
      entry.resource,
      entry.result
    ].some((value) => value.toLowerCase().includes(normalized)))
  })

  onMount(() => {
    void appState.fetchAudit()
  })
</script>

<section class="route-page" aria-labelledby="audit-title">
  <RouteHeader routeName="审计" stateSources={['audit']} />
  <h2 id="audit-title" class="section-title">高可信审计账本</h2>
  <p class="section-copy">审计事实只展示可读取记录；无 audit:read 时保持区域可见并显示拒绝原因。</p>

  {#if appState.audit === null}
    <InlineOperationalAlert message="访问被拒绝：当前操作者缺少 audit:read 权限，无法读取审计事实。" severity="block" />
  {/if}

  <div class="panel">
    <FilterBar placeholder="过滤审计记录" onFilter={(value) => query = value} />
    <AuditLedger entries={filteredEntries} />
  </div>

  {#if appState.audit !== null}
    <RawEnvelopeView title="原始审计数据" data={appState.audit} />
  {/if}
</section>

<style>
  .route-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    color: var(--text-100);
  }

  .section-title {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .section-copy {
    color: var(--text-60);
    font-size: var(--text-sm);
    line-height: var(--lh-log);
    margin: 0;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--line-soft) 84%, transparent);
    border-radius: var(--glass-panel-radius);
    background:
      linear-gradient(
        145deg,
        color-mix(in srgb, var(--surface-panel) 96%, var(--surface-chrome)),
        color-mix(in srgb, var(--surface-root) 96%, black)
      );
    box-shadow:
      inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 32%, transparent),
      0 var(--space-2) var(--space-4) color-mix(in srgb, var(--surface-root) 78%, var(--surface-panel));
    padding: var(--space-4);
  }
</style>
