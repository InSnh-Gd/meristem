<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'
  import type { GenericCommandParams } from '$lib/types.ts'

  const stateSources = ['authoritative', 'policy', 'audit']

  let targetProfileVersion = $state('')
  let batchSize = $state(100)
  let reason = $state('')
  let operationId = $state('')
  
  let commandId = $state('network.migration.dry-run.execute')

  const commands = [
    { id: 'network.migration.dry-run.execute', label: '准备迁移 (Dry-run)' },
    { id: 'network.migration.apply.execute', label: '执行迁移 (Apply)' },
    { id: 'network.migration.resume.execute', label: '恢复迁移 (Resume)' },
    { id: 'network.migration.rollback.execute', label: '回滚迁移 (Rollback)' }
  ]

  async function checkEligibility() {
    const params: Record<string, unknown> = {}
    if (commandId === 'network.migration.dry-run.execute') {
      if (!targetProfileVersion) return
      params.targetProfileVersion = targetProfileVersion
      params.batchSize = batchSize
      if (reason) params.reason = reason
    } else {
      if (!operationId) return
      params.operationId = operationId
      if (commandId === 'network.migration.rollback.execute' && reason) {
        params.reason = reason
      }
    }
    
    appState.commandState = null
    appState.commandParams = params
    try {
      const { fetchCommandEligibility } = await import('$lib/bff')
      appState.commandState = await fetchCommandEligibility(appState.token, commandId, params as GenericCommandParams)
    } catch (e: unknown) {
      const { formatBffError } = await import('$lib/bff')
      appState.commandState = null
      appState.commandParams = null
      appState.commandStateError = formatBffError(e, '验证操作资格失败')
    }
  }

  $effect(() => {
    targetProfileVersion
    batchSize
    reason
    operationId
    commandId
    appState.commandState = null
  })

  onMount(() => {
    void appState.fetchGlobalDefaults()
  })
</script>

<svelte:head>
  <title>Profile 迁移 | Meristem</title>
</svelte:head>

<section class="migration-page">
  <RouteHeader routeName="Profile 迁移" {stateSources} />

  <div class="panel status-panel workbench-panel">
    <div class="zone-titles">
      <span class="zone-eyebrow">Global config state</span>
      <h3>全局配置状态</h3>
    </div>
    {#if appState.globalDefaultsLoading}
      <p class="empty-state">加载中...</p>
    {:else if appState.globalDefaultsError}
      <div class="error-container">
        <InlineOperationalAlert message={appState.globalDefaultsError} severity="block" />
      </div>
    {:else if appState.globalDefaults}
      <dl class="meta-grid">
        <div>
          <dt>当前默认 Profile</dt>
          <dd class="mono">{appState.globalDefaults.defaultProfileVersion}</dd>
        </div>
        <div>
          <dt>迁移状态</dt>
          <dd class="mono">{appState.globalDefaults.globalSwitchState}</dd>
        </div>
        <div>
          <dt>活跃 Operation ID</dt>
          <dd class="mono">{appState.globalDefaults.switchOperationId || '无'}</dd>
        </div>
        <div>
          <dt>更新时间</dt>
          <dd class="mono">{appState.globalDefaults.updatedAt}</dd>
        </div>
      </dl>
      <div style="margin-top: var(--space-3)">
        <StateSourceBadge source={appState.globalDefaults.stateSource.sourceType} />
      </div>
    {:else}
      <p class="empty-state error">无法加载全局配置</p>
    {/if}
  </div>

  <div class="panel form-panel workbench-panel">
    <div class="zone-titles">
      <span class="zone-eyebrow">Migration command</span>
      <h3>迁移操作验证</h3>
    </div>
    <div class="form-group">
      <label for="command-select">操作类型</label>
      <select id="command-select" bind:value={commandId}>
        {#each commands as cmd}
          <option value={cmd.id}>{cmd.label}</option>
        {/each}
      </select>
    </div>

    {#if commandId === 'network.migration.dry-run.execute'}
      <div class="form-row">
        <div class="form-group">
          <label for="target-profile">目标 Profile 版本</label>
          <input id="target-profile" type="text" bind:value={targetProfileVersion} class="mono" placeholder="如 m-net-cn@0.3.0" />
        </div>
        <div class="form-group">
          <label for="batch-size">批次大小</label>
          <input id="batch-size" type="number" bind:value={batchSize} />
        </div>
      </div>
      <div class="form-group">
        <label for="dry-run-reason">操作原因 (可选)</label>
        <input id="dry-run-reason" type="text" bind:value={reason} placeholder="输入原因..." />
      </div>
    {:else}
      <div class="form-group">
        <label for="operation-id">Operation ID</label>
        <input id="operation-id" type="text" bind:value={operationId} class="mono" placeholder="输入迁移任务 ID..." />
      </div>
      {#if commandId === 'network.migration.rollback.execute'}
        <div class="form-group">
          <label for="rollback-reason">回滚原因</label>
          <input id="rollback-reason" type="text" bind:value={reason} placeholder="输入回滚原因..." />
        </div>
      {/if}
    {/if}

    <div class="action-row">
      <button class="workbench-btn workbench-btn-primary" onclick={checkEligibility}>验证操作资格</button>
    </div>
  </div>
</section>

<div class="command-region">
  <CommandWell
    commandState={appState.commandState}
    commandStateError={appState.commandStateError}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    emptyStateText="请在面板中验证迁移操作"
    targetLabel="迁移操作"
    targetName={commandId}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={async () => {
      await appState.executeGenericCommand()
      void appState.fetchGlobalDefaults()
    }}
  />
</div>

<style>
  .migration-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    margin-bottom: 120px;
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    min-width: 0;
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h3 {
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    color: var(--text-100);
    margin: 0;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .meta-grid div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--line-soft) 72%, transparent);
    border-radius: var(--control-radius);
    background: color-mix(in srgb, var(--surface-root) 70%, var(--surface-panel));
  }

  dt {
    font-size: var(--text-xs);
    color: var(--text-60);
  }

  dd {
    font-size: var(--text-sm);
    color: var(--text-100);
    margin: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .empty-state {
    font-size: var(--text-sm);
    color: var(--text-60);
  }

  .empty-state.error {
    color: var(--signal-warn);
  }

  .form-row {
    display: flex;
    gap: var(--space-3);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  label {
    font-size: var(--text-xs);
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  input, select {
    padding: var(--space-2);
    border: 1px solid var(--line-soft);
    border-radius: var(--control-radius);
    background: var(--surface-root);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  input:focus, select:focus {
    outline: 1px solid var(--signal-info);
    border-color: var(--line-strong);
  }

  .action-row {
    margin-top: var(--space-2);
  }

  .command-region {
    position: fixed;
    right: 0;
    bottom: 0;
    left: var(--nav-rail-width);
    z-index: 10;
    border-top: 1px solid var(--line-strong);
    background: var(--surface-root);
    padding: var(--space-3) var(--shell-padding-x);
  }
</style>
