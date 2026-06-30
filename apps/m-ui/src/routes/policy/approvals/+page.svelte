<script lang="ts">
  import { onMount } from 'svelte'
  import ApprovalQueuePanel from '$lib/components/modules/policy/ApprovalQueuePanel.svelte'
  import DecisionQueueSummary from '$lib/components/modules/policy/DecisionQueueSummary.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import OperationalCommandPreview from '$lib/components/modules/policy/OperationalCommandPreview.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import { appState as muiStores } from '$lib/stores.svelte.ts'

  const stateSources = ['policy', 'audit']

  const pendingCount = $derived(
    (muiStores.approvalQueue?.approvals ?? []).filter((approval) => approval.status === 'pending').length
  )

  onMount(() => {
    void muiStores.fetchApprovalQueue()
  })
</script>

<svelte:head>
  <title>审批队列 | Meristem</title>
</svelte:head>

<section class="route-page" aria-labelledby="approval-queue-title">
  <RouteHeader routeName="审批队列" {stateSources} />

  <div class="title-row">
    <div>
      <h2 id="approval-queue-title" class="section-title">审批队列</h2>
      <p class="section-copy">展示待处理审批、状态来源与策略决策编号，不提供前端执行入口。</p>
    </div>
    <DecisionQueueSummary pendingCount={pendingCount} />
  </div>

  {#if muiStores.approvalQueueError}
    <InlineOperationalAlert message={muiStores.approvalQueueError} severity="block" />
  {/if}

  <section class="panel workbench-panel" aria-label="审批列表">
    {#if muiStores.approvalQueueLoading}
      <p class="empty-state">正在加载审批队列。</p>
    {:else}
      <ApprovalQueuePanel approvals={muiStores.approvalQueue?.approvals ?? []} />
    {/if}
  </section>

  <section class="preview-grid" aria-label="审批命令预览">
    <OperationalCommandPreview
      commandId="policy.approval.approve.preview"
      disabledReason="当前页面仅提供审批可见性，批准动作保留为展示态。"
      resource="approval/*"
    />
    <OperationalCommandPreview
      commandId="policy.approval.reject.preview"
      disabledReason="当前页面仅提供审批可见性，拒绝动作保留为展示态。"
      resource="approval/*"
    />
  </section>
</section>

<style>
  .route-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .title-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .section-title,
  .section-copy,
  .empty-state {
    color: var(--text-100);
  }

  .section-title {
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .section-copy,
  .empty-state {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
    margin: 0;
  }

  @media (max-width: 760px) {
    .title-row {
      flex-direction: column;
    }

    .preview-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
