<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import ApprovalDetailPanel from '$lib/components/modules/policy/ApprovalDetailPanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import OperationalCommandPreview from '$lib/components/modules/policy/OperationalCommandPreview.svelte'
  import RawEnvelopeView from '$lib/components/ui/RawEnvelopeView.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import { executeCommand, formatBffError } from '$lib/bff.ts'
  import { appState as muiStores } from '$lib/stores.svelte.ts'
  import type { ApprovalCommandResult } from '$lib/types.ts'

  const stateSources = ['policy', 'audit', 'log']
  const approvalId = $derived(page.params.id)
  const approvalPreviewReason = '只读预览，实际执行需通过下方 CommandWell 确认并提交审批动作'

  type ApprovalCommandKind = 'approve' | 'reject'

  let pendingApprovalCommand = $state<ApprovalCommandKind | null>(null)
  let commandRunning = $state(false)
  let commandError = $state<string | null>(null)
  let commandResult = $state<ApprovalCommandResult | null>(null)

  const canRunApprovalCommand = $derived(
    muiStores.selectedApproval?.status === 'pending' && !commandRunning
  )

  onMount(() => {
    if (approvalId) {
      void muiStores.fetchApprovalDetail(approvalId)
    }
  })

  function requestApprovalCommand(kind: ApprovalCommandKind) {
    if (!approvalId || commandRunning) return
    pendingApprovalCommand = kind
    commandError = null
    commandResult = null
  }

  function cancelApprovalCommand() {
    pendingApprovalCommand = null
  }

  /** 审批命令通过 BFF CommandWell 执行端点提交到 Core 公共 facade。 */
  async function confirmApprovalCommand() {
    if (!pendingApprovalCommand || !approvalId || !muiStores.token) return
    const commandId = `policy.approval.${pendingApprovalCommand}.execute`

    commandRunning = true
    commandError = null
    try {
      commandResult = await executeCommand<ApprovalCommandResult>(muiStores.token, commandId, {
        approvalId
      })
      pendingApprovalCommand = null
      await muiStores.fetchApprovalDetail(approvalId)
    } catch (e: unknown) {
      commandError = formatBffError(e, '审批命令执行失败')
    } finally {
      commandRunning = false
    }
  }
</script>

<svelte:head>
  <title>审批详情 | Meristem</title>
</svelte:head>

<section class="route-page" aria-labelledby="approval-detail-title">
  <RouteHeader routeName="审批详情" {stateSources} />

  <div>
    <h2 id="approval-detail-title" class="section-title">审批详情</h2>
    <p class="section-copy">审批主体、投票记录与原始 envelope，支持批准与拒绝执行。</p>
  </div>

  {#if muiStores.selectedApprovalError}
    <InlineOperationalAlert message={muiStores.selectedApprovalError} severity="block" />
  {/if}

  {#if muiStores.selectedApprovalLoading}
    <section class="empty-panel workbench-panel">
      <p>正在加载审批详情。</p>
    </section>
  {:else if muiStores.selectedApproval}
    <div class="detail-layout">
      <div class="detail-stack">
        <ApprovalDetailPanel approval={muiStores.selectedApproval} />

        <!-- 审批只读预览：保留操作元数据可见性 -->
        <section class="preview-grid" aria-label="审批命令预览">
          <OperationalCommandPreview
            commandId="policy.approval.approve.preview"
            disabledReason={approvalPreviewReason}
            resource={`approval/${muiStores.selectedApproval.id}`}
          />
          <OperationalCommandPreview
            commandId="policy.approval.reject.preview"
            disabledReason={approvalPreviewReason}
            resource={`approval/${muiStores.selectedApproval.id}`}
          />
        </section>

        <!-- 审批 CommandWell 执行区 -->
        <section class="command-well-panel workbench-panel" aria-label="审批 CommandWell">
          <div class="command-header-block">
            <div class="zone-titles">
              <span class="zone-eyebrow">CommandWell</span>
              <h3>审批执行命令</h3>
            </div>
            <span class="risk-chip">high risk</span>
          </div>

          {#if !canRunApprovalCommand}
            <p class="disabled-reason">
              {muiStores.selectedApproval?.status !== 'pending'
                ? '审批已不是 pending 状态'
                : '执行中...'}
            </p>
          {/if}

          <div class="approval-command-actions">
            <button
              type="button"
              class="workbench-btn workbench-btn-primary"
              disabled={!canRunApprovalCommand}
              onclick={() => requestApprovalCommand('approve')}
            >
              批准审批请求
            </button>
            <button
              type="button"
              class="workbench-btn workbench-btn-risk"
              disabled={!canRunApprovalCommand}
              onclick={() => requestApprovalCommand('reject')}
            >
              拒绝审批请求
            </button>
          </div>

          {#if pendingApprovalCommand}
            <div class="command-confirm" role="group" aria-label="审批命令确认">
              <div class="confirm-details">
                <div>目标: approval/{approvalId}</div>
                <div>
                  操作: {pendingApprovalCommand === 'approve' ? '批准' : '拒绝'}
                </div>
                <div>
                  权限: policy:approval-{pendingApprovalCommand}
                </div>
                <div>策略: 需要</div>
                <div>审计: 需要</div>
              </div>
              <div class="confirm-actions">
                <button type="button" class="workbench-btn workbench-btn-primary" disabled={commandRunning} onclick={confirmApprovalCommand}>
                  确认执行
                </button>
                <button type="button" class="workbench-btn" disabled={commandRunning} onclick={cancelApprovalCommand}>
                  取消
                </button>
              </div>
            </div>
          {/if}

          {#if commandError}
            <InlineOperationalAlert message={commandError} severity="block" />
          {/if}

          {#if commandResult}
            <dl class="command-result" aria-label="审批命令结果">
              <div>
                <dt>approval.id</dt>
                <dd>{commandResult.approval.id}</dd>
              </div>
              <div>
                <dt>approval.status</dt>
                <dd>{commandResult.approval.status}</dd>
              </div>
              <div>
                <dt>votes</dt>
                <dd>{commandResult.votes.length}</dd>
              </div>
              {#if commandResult.correlationId}
                <div>
                  <dt>correlationId</dt>
                  <dd>{commandResult.correlationId}</dd>
                </div>
              {/if}
            </dl>
            <RawEnvelopeView title="审批命令原始结果" data={commandResult} />
          {/if}
        </section>
      </div>

      <aside class="raw-panel" aria-label="审批原始数据">
        <RawEnvelopeView title="原始审批数据" data={muiStores.selectedApproval} />
      </aside>
    </div>
  {:else}
    <section class="empty-panel workbench-panel">
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
    min-width: 0;
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
    margin: 0;
  }

  .section-copy,
  .empty-panel {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .mono {
    font-family: var(--font-mono);
  }

  /* CommandWell 执行区样式 */
  .command-well-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .command-header-block {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .command-header-block h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    color: var(--text-100);
  }

  .risk-chip {
    font-size: var(--text-xs);
    background: var(--signal-warn);
    color: var(--surface-root);
    padding: 2px 8px;
    border-radius: var(--radius-xs);
    font-weight: var(--fw-medium);
  }

  .disabled-reason {
    font-size: var(--text-xs);
    color: var(--signal-warn);
    margin: 0;
  }

  .approval-command-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .command-confirm {
    border: 1px solid var(--signal-warn);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--signal-warn) 8%, var(--surface-root));
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .confirm-details {
    font-size: var(--text-xs);
    color: var(--text-80);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-2);
  }

  .command-result {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--text-xs);
    color: var(--text-80);
    margin: 0;
  }

  .command-result dt {
    font-weight: var(--fw-semibold);
    display: inline;
    margin-right: var(--space-1);
  }

  .command-result dd {
    display: inline;
    font-family: var(--font-mono);
    margin: 0;
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

    .approval-command-actions {
      flex-direction: column;
    }
  }
</style>
