<script lang="ts">
  import type { ApprovalDetailResponseData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  const requiredActionLabel: Record<ApprovalDetailResponseData['requiredAction'], string> = {
    manual_review: '人工审核',
    multi_approval: '多重审批'
  }

  const statusLabel: Record<ApprovalDetailResponseData['status'], string> = {
    pending: '待处理',
    approved: '已批准',
    rejected: '已拒绝',
    expired: '已过期',
    canceled: '已取消'
  }

  const voteLabel = {
    approve: '批准',
    reject: '拒绝'
  } as const

  type Props = { approval: ApprovalDetailResponseData }

  let { approval }: Props = $props()

  function formatTimestamp(value: string) {
    return new Date(value).toLocaleString('zh-CN')
  }
</script>

<section class="approval-detail-panel workbench-panel" aria-label="审批详情面板">
  <div class="approval-header">
    <div class="zone-titles">
      <p class="zone-eyebrow">审批详情</p>
      <h3>{approval.id}</h3>
    </div>
    <div class="header-badges">
      <span class="approval-status">{statusLabel[approval.status]}</span>
      <StateSourceBadge source={approval.stateSource.sourceType} />
    </div>
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
    {#if approval.completedAt}
      <div>
        <dt>完成时间</dt>
        <dd>{formatTimestamp(approval.completedAt)}</dd>
      </div>
    {/if}
    <div>
      <dt>来源 ID</dt>
      <dd>{approval.stateSource.sourceId}</dd>
    </div>
  </dl>

  <section class="vote-section" aria-labelledby="approval-votes-title">
    <div class="vote-header">
      <h4 id="approval-votes-title">投票记录</h4>
      <span class="vote-count">{approval.votes.length} 条</span>
    </div>

    {#if approval.votes.length === 0}
      <p class="workbench-empty">暂无投票记录。</p>
    {:else}
      <div class="vote-list">
        {#each approval.votes as vote}
          <article class="vote-card workbench-card">
            <div class="vote-topline">
              <span class="mono">{vote.actor}</span>
              <span class="vote-result">{voteLabel[vote.vote]}</span>
            </div>
            <dl class="vote-meta">
              <div>
                <dt>投票时间</dt>
                <dd>{formatTimestamp(vote.createdAt)}</dd>
              </div>
              <div>
                <dt>来源继承</dt>
                <dd>{approval.stateSource.sourceType}</dd>
              </div>
              {#if vote.reason}
                <div class="vote-reason">
                  <dt>原因</dt>
                  <dd>{vote.reason}</dd>
                </div>
              {/if}
            </dl>
          </article>
        {/each}
      </div>
    {/if}
  </section>
</section>

<style>
  .approval-detail-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .approval-header,
  .header-badges,
  .vote-topline,
  .vote-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .header-badges,
  .vote-topline {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .zone-eyebrow,
  .approval-status,
  .vote-count,
  .approval-meta dt,
  .approval-meta dd,
  .vote-meta dt,
  .vote-meta dd,
  .workbench-empty {
    font-size: var(--text-xs);
  }

  .zone-eyebrow,
  .approval-meta dt,
  .vote-meta dt {
    color: var(--text-60);
  }

  h3,
  h4 {
    color: var(--text-100);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  h3 {
    font-size: var(--text-lg);
  }

  h4 {
    font-size: var(--text-sm);
  }

  .approval-status,
  .vote-result {
    color: var(--text-100);
    font-weight: var(--fw-semibold);
  }

  .approval-meta,
  .vote-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .approval-meta div,
  .vote-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--line-soft) 72%, transparent);
    border-radius: var(--control-radius);
    background: color-mix(in srgb, var(--surface-root) 70%, var(--surface-panel));
  }

  .approval-meta dd,
  .vote-meta dd,
  .workbench-empty {
    color: var(--text-100);
    font-family: var(--font-mono);
    line-height: var(--lh-log);
    margin: 0;
    word-break: break-word;
  }

  .vote-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .vote-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .vote-card {
    padding: var(--space-3);
  }

  .vote-reason {
    grid-column: 1 / -1;
  }

  .mono {
    color: var(--text-100);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  @media (max-width: 760px) {
    .approval-header,
    .vote-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .approval-meta,
    .vote-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
