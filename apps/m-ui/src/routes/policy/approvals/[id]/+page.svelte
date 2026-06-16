<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import ApprovalDetailPanel from '$lib/components/ApprovalDetailPanel.svelte'
  import InlineOperationalAlert from '$lib/components/InlineOperationalAlert.svelte'
  import OperationalCommandPreview from '$lib/components/OperationalCommandPreview.svelte'
  import RawEnvelopeView from '$lib/components/RawEnvelopeView.svelte'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import { appState as muiStores } from '$lib/stores.svelte.ts'

  const stateSources = ['policy', 'audit', 'log']
  const approvalId = $derived(page.params.id)

  onMount(() => {
    if (approvalId) {
      void muiStores.fetchApprovalDetail(approvalId)
    }
  })
</script>

<svelte:head>
  <title>审批详情 | Meristem</title>
</svelte:head>

<section class="route-page" aria-labelledby="approval-detail-title">
  <RouteHeader routeName="审批详情" {stateSources} />

  <div>
    <h2 id="approval-detail-title" class="section-title">审批详情</h2>
    <p class="section-copy">保留审批主体、投票记录与原始 envelope，可追溯但不可直接执行。</p>
  </div>

  {#if muiStores.selectedApprovalError}
    <InlineOperationalAlert message={muiStores.selectedApprovalError} severity="block" />
  {/if}

  {#if muiStores.selectedApprovalLoading}
    <section class="empty-panel">
      <p>正在加载审批详情。</p>
    </section>
  {:else if muiStores.selectedApproval}
    <div class="detail-layout">
      <div class="detail-stack">
        <ApprovalDetailPanel approval={muiStores.selectedApproval} />
        <section class="preview-grid" aria-label="审批详情命令预览">
          <OperationalCommandPreview
            commandId="policy.approval.approve.preview"
            disabledReason="当前演示壳仅展示审批命令资格，不允许直接批准。"
            resource={`approval/${muiStores.selectedApproval.id}`}
          />
          <OperationalCommandPreview
            commandId="policy.approval.reject.preview"
            disabledReason="当前演示壳仅展示审批命令资格，不允许直接拒绝。"
            resource={`approval/${muiStores.selectedApproval.id}`}
          />
        </section>
      </div>

      <aside class="raw-panel" aria-label="审批原始数据">
        <RawEnvelopeView title="原始审批数据" data={muiStores.selectedApproval} />
      </aside>
    </div>
  {:else}
    <section class="empty-panel">
      <p>未找到审批：<span class="mono">{approvalId}</span></p>
    </section>
  {/if}
</section>

<style>
  .route-page,
  .detail-stack {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .detail-layout {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .raw-panel,
  .empty-panel {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .section-title,
  .section-copy,
  .empty-panel {
    color: var(--text-100);
  }

  .section-title {
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .section-copy,
  .empty-panel {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 960px) {
    .detail-layout {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .preview-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
