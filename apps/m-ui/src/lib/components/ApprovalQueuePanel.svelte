<script lang="ts">
  import type { ApprovalQueueResponseData } from '$lib/types.ts'
  import StateSourceBadge from './StateSourceBadge.svelte'

  type ApprovalItem = ApprovalQueueResponseData['approvals'][number]
  type Props = {
    approvals: ApprovalItem[]
    detailBasePath?: string
    selectedApprovalId?: string | null
  }

  const requiredActionLabel: Record<ApprovalItem['requiredAction'], string> = {
    manual_review: '人工审核',
    multi_approval: '多重审批'
  }

  const statusLabel: Record<ApprovalItem['status'], string> = {
    pending: '待处理',
    approved: '已批准',
    rejected: '已拒绝',
    expired: '已过期',
    canceled: '已取消'
  }

  let {
    approvals,
    detailBasePath = '/policy/approvals',
    selectedApprovalId = null
  }: Props = $props()

  function formatTimestamp(value: string) {
    return new Date(value).toLocaleString('zh-CN')
  }
  </script>

{#if approvals.length === 0}
  <p class="empty-state">暂无审批记录。</p>
{:else}
  <div class="approval-list" role="list" aria-label="审批队列">
    {#each approvals as approval}
        <a
          class:selected={selectedApprovalId === approval.id}
          class="approval-card"
          href={`${detailBasePath}/${encodeURIComponent(approval.id)}`}
        >
          <div class="approval-header">
            <div class="approval-title-block">
              <span class="approval-id">{approval.id}</span>
              <span class="approval-status">{statusLabel[approval.status]}</span>
            </div>
            <StateSourceBadge source={approval.stateSource.sourceType} />
        </div>

        <dl class="approval-meta">
          <div>
            <dt>策略决策</dt>
            <dd>{approval.policyDecisionId}</dd>
          </div>
          <div>
            <dt>来源服务</dt>
            <dd>{approval.originService}</dd>
          </div>
          <div>
            <dt>操作 ID</dt>
            <dd>{approval.operationId}</dd>
          </div>
          <div>
            <dt>申请人</dt>
            <dd>{approval.requestedBy}</dd>
          </div>
          <div>
            <dt>审批动作</dt>
            <dd>{requiredActionLabel[approval.requiredAction]}</dd>
          </div>
          <div>
            <dt>法定人数</dt>
            <dd>{approval.quorumRequired}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatTimestamp(approval.createdAt)}</dd>
          </div>
          <div>
            <dt>到期时间</dt>
            <dd>{formatTimestamp(approval.expiresAt)}</dd>
          </div>
        </dl>

        <p class="state-source-copy">来源 ID：<span class="mono">{approval.stateSource.sourceId}</span></p>
      </a>
    {/each}
  </div>
{/if}

<style>
  .approval-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .approval-card,
  .empty-state {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-3);
  }

  .approval-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    color: var(--text-100);
    text-decoration: none;
  }

  .approval-card:hover,
  .approval-card:focus-visible,
  .approval-card.selected {
    border-color: var(--line-strong);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  .approval-header,
  .approval-title-block {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .approval-title-block {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .approval-id,
  .approval-meta dd,
  .state-source-copy,
  .mono {
    font-family: var(--font-mono);
  }

  .approval-id,
  .approval-status,
  .approval-meta dt,
  .approval-meta dd,
  .state-source-copy,
  .empty-state {
    font-size: var(--text-xs);
  }

  .approval-status {
    font-weight: var(--fw-semibold);
  }

  .approval-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .approval-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .approval-meta dt {
    color: var(--text-60);
  }

  .approval-meta dd,
  .state-source-copy,
  .empty-state {
    margin: 0;
    color: var(--text-100);
    line-height: var(--lh-log);
    word-break: break-word;
  }

  @media (max-width: 760px) {
    .approval-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .approval-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
