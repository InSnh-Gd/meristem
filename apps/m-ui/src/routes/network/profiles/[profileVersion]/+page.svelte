<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import GlobalProfileControls from '$lib/components/GlobalProfileControls.svelte'
  import InlineOperationalAlert from '$lib/components/InlineOperationalAlert.svelte'
  import NetworkProfileDetailPanel from '$lib/components/NetworkProfileDetailPanel.svelte'
  import RawEnvelopeView from '$lib/components/RawEnvelopeView.svelte'
  import OperationalCommandPreview from '$lib/components/OperationalCommandPreview.svelte'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import { bffFetch, executeCommand, formatBffError } from '$lib/bff.ts'
  import { appState as muiStores } from '$lib/stores.svelte.ts'
  import type { NetworkListResponseData, ProfileCommandResult } from '$lib/types.ts'

  const stateSources = ['authoritative', 'policy', 'audit', 'log']
  const profileVersion = $derived(page.params.profileVersion)
  const missingNetworkReason = '请先选择目标网络'
  const profilePreviewReason =
    '只读预览，实际执行需通过下方 CommandWell 选择目标网络并确认执行'

  type ProfileCommandKind = 'enable' | 'disable'

  let networks = $state<NetworkListResponseData['networks']>([])
  let selectedNetworkId = $state('')
  let networksLoading = $state(false)
  let networksError = $state<string | null>(null)
  let pendingProfileCommand = $state<ProfileCommandKind | null>(null)
  let commandRunning = $state(false)
  let commandError = $state<string | null>(null)
  let commandResult = $state<ProfileCommandResult | null>(null)

  const selectedNetwork = $derived(
    networks.find(network => network.id === selectedNetworkId) ?? null
  )
  const canRunProfileCommand = $derived(Boolean(selectedNetworkId && !commandRunning))

  onMount(() => {
    if (profileVersion) {
      void muiStores.fetchNetworkProfileDetail(profileVersion)
    }
    void fetchNetworks()
  })

  /** 通过 M-UI BFF 读取网络列表，前端不直接访问 Core/M-Net。 */
  async function fetchNetworks() {
    if (!muiStores.token) return
    networksLoading = true
    networksError = null
    try {
      const data = await bffFetch<NetworkListResponseData>('/api/v0/networks', muiStores.token)
      networks = data.networks ?? []
    } catch (e: unknown) {
      networksError = formatBffError(e, '目标网络加载失败')
      networks = []
    } finally {
      networksLoading = false
    }
  }

  function requestProfileCommand(kind: ProfileCommandKind) {
    if (!selectedNetworkId || commandRunning) return
    pendingProfileCommand = kind
    commandError = null
    commandResult = null
  }

  function cancelProfileCommand() {
    pendingProfileCommand = null
  }

  /** Profile 命令必须带显式 networkId，并通过 BFF CommandWell 执行端点提交。 */
  async function confirmProfileCommand() {
    if (!pendingProfileCommand || !selectedNetworkId || !muiStores.token) return
    const kind = pendingProfileCommand
    const commandId = `network.profile.${kind}.execute`
    const targetProfileVersion = kind === 'enable' ? 'm-net-cn@0.1.0' : 'm-net-default@0.1.0'

    commandRunning = true
    commandError = null
    try {
      commandResult = await executeCommand<ProfileCommandResult>(muiStores.token, commandId, {
        networkId: selectedNetworkId,
        profileVersion: targetProfileVersion
      })
      pendingProfileCommand = null
      await muiStores.fetchNetworkProfileDetail(profileVersion)
      await fetchNetworks()
    } catch (e: unknown) {
      commandError = formatBffError(e, 'Profile 命令执行失败')
    } finally {
      commandRunning = false
    }
  }
</script>

<svelte:head>
  <title>Profile 详情 | Meristem</title>
</svelte:head>

<section class="route-page" aria-labelledby="network-profile-detail-title">
  <RouteHeader routeName="Profile 详情" {stateSources} />

  <div>
    <h2 id="network-profile-detail-title" class="section-title">Profile 详情</h2>
    <p class="section-copy">保留 Profile 能力、规则与只读命令预览，避免在前端发起直接切换。</p>
  </div>

  {#if muiStores.selectedProfileError}
    <InlineOperationalAlert message={muiStores.selectedProfileError} severity="block" />
  {/if}

  {#if muiStores.selectedProfileLoading}
    <section class="empty-panel">
      <p>正在加载 Profile 详情。</p>
    </section>
  {:else if muiStores.selectedProfile}
    <div class="detail-layout">
      <div class="detail-stack">
        <NetworkProfileDetailPanel profile={muiStores.selectedProfile} />
        <GlobalProfileControls {profileVersion} />
        <section class="network-target-panel" aria-labelledby="network-target-title">
          <div class="command-header-block">
            <div>
              <p class="eyebrow">目标网络</p>
              <h3 id="network-target-title">选择 Profile 命令目标</h3>
            </div>
            <span class="source-chip">source: authoritative</span>
          </div>

          <label class="network-select-label" for="network-target-select">目标网络</label>
          <select
            id="network-target-select"
            bind:value={selectedNetworkId}
            disabled={networksLoading || networks.length === 0}
            aria-describedby="network-target-help"
          >
            <option value="">请选择目标网络</option>
            {#each networks as network}
              <option value={network.id}>{network.name} / {network.id}</option>
            {/each}
          </select>
          <p id="network-target-help" class="control-plane-warning">
            配置变更仅影响控制平面，运行时数据面不受影响
          </p>

          {#if networksError}
            <InlineOperationalAlert message={networksError} severity="block" />
          {:else if networksLoading}
            <p class="command-copy">正在加载目标网络。</p>
          {:else if networks.length === 0}
            <p class="command-copy">暂无可选目标网络。</p>
          {/if}
        </section>

        <!-- Profile 只读预览：保留操作元数据可见性 -->
        <section class="preview-grid" aria-label="Profile 命令预览">
          <OperationalCommandPreview
            commandId="network.profile.enable.preview"
            disabledReason={profilePreviewReason}
            resource={`network/${selectedNetworkId || '未选择'}`}
          />
          <OperationalCommandPreview
            commandId="network.profile.disable.preview"
            disabledReason={profilePreviewReason}
            resource={`network/${selectedNetworkId || '未选择'}`}
          />
        </section>

        <section class="command-well-panel" aria-label="Profile CommandWell">
          <div class="command-header-block">
            <div>
              <p class="eyebrow">CommandWell</p>
              <h3>Profile 启停命令</h3>
            </div>
            <span class="risk-chip">high risk</span>
          </div>

          {#if !selectedNetworkId}
            <p class="disabled-reason" data-testid="profile-command-disabled-reason">
              {missingNetworkReason}
            </p>
          {:else}
            <p class="command-copy">
              当前目标：<span class="mono">{selectedNetwork?.name ?? selectedNetworkId}</span>
            </p>
          {/if}

          <div class="profile-command-actions">
            <button
              type="button"
              class="btn-command"
              disabled={!canRunProfileCommand}
              onclick={() => requestProfileCommand('enable')}
            >
              {selectedNetworkId ? '启用 m-net-cn@0.1.0' : missingNetworkReason}
            </button>
            <button
              type="button"
              class="btn-command btn-risk"
              disabled={!canRunProfileCommand}
              onclick={() => requestProfileCommand('disable')}
            >
              {selectedNetworkId ? '停用并恢复 m-net-default@0.1.0' : missingNetworkReason}
            </button>
          </div>

          {#if pendingProfileCommand}
            <div class="command-confirm" role="group" aria-label="Profile 命令确认">
              <div class="confirm-details">
                <div>目标网络: {selectedNetwork?.name ?? selectedNetworkId}</div>
                <div>
                  Profile: {pendingProfileCommand === 'enable'
                    ? 'm-net-cn@0.1.0'
                    : 'm-net-default@0.1.0'}
                </div>
                <div>
                  权限: {pendingProfileCommand === 'enable'
                    ? 'network:profile-enable'
                    : 'network:profile-disable'}
                </div>
                <div>策略: 需要</div>
                <div>审计: 需要</div>
              </div>
              <div class="confirm-actions">
                <button type="button" class="btn-confirm" disabled={commandRunning} onclick={confirmProfileCommand}>
                  确认执行
                </button>
                <button type="button" class="btn-cancel" disabled={commandRunning} onclick={cancelProfileCommand}>
                  取消
                </button>
              </div>
            </div>
          {/if}

          {#if commandError}
            <InlineOperationalAlert message={commandError} severity="block" />
          {/if}

          {#if commandResult}
            <dl class="command-result" aria-label="Profile 命令结果">
              <div>
                <dt>status</dt>
                <dd>{commandResult.status}</dd>
              </div>
              <div>
                <dt>correlationId</dt>
                <dd>{commandResult.correlationId}</dd>
              </div>
              {#if commandResult.operationId}
                <div>
                  <dt>operationId</dt>
                  <dd>{commandResult.operationId}</dd>
                </div>
              {/if}
              {#if commandResult.approvalId}
                <div>
                  <dt>approvalId</dt>
                  <dd>{commandResult.approvalId}</dd>
                </div>
              {/if}
              {#if commandResult.profileVersion}
                <div>
                  <dt>profileVersion</dt>
                  <dd>{commandResult.profileVersion}</dd>
                </div>
              {/if}
            </dl>
            <RawEnvelopeView title="Profile 命令原始结果" data={commandResult} />
          {/if}
        </section>
      </div>

      <aside class="raw-panel" aria-label="Profile 原始数据">
        <RawEnvelopeView title="原始 Profile 数据" data={muiStores.selectedProfile} />
      </aside>
    </div>
  {:else}
    <section class="empty-panel">
      <p>未找到 Profile：<span class="mono">{profileVersion}</span></p>
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

  .profile-command-actions,
  .command-result {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .raw-panel,
  .empty-panel,
  .network-target-panel,
  .command-well-panel {
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .network-target-panel,
  .command-well-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .command-header-block,
  .command-confirm {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .section-title,
  .section-copy,
  .empty-panel,
  h3,
  .command-copy,
  .control-plane-warning,
  .command-result dd {
    color: var(--text-100);
  }

  .section-title,
  h3 {
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  h3 {
    margin: 0;
  }

  .section-copy,
  .empty-panel,
  .command-copy,
  .control-plane-warning {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .eyebrow,
  .source-chip,
  .risk-chip,
  .network-select-label,
  .disabled-reason,
  .confirm-details,
  .command-result dt,
  .command-result dd {
    font-size: var(--text-xs);
  }

  .eyebrow,
  .network-select-label,
  .command-result dt {
    color: var(--text-60);
  }

  .source-chip,
  .risk-chip {
    border: 1px solid var(--line-strong);
    color: var(--text-80);
    padding: 0 var(--space-2);
    white-space: nowrap;
  }

  .risk-chip,
  .disabled-reason {
    color: var(--signal-warn);
  }

  select {
    width: 100%;
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    background: var(--surface-sunken);
    color: var(--text-100);
    font-family: var(--font-body);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  select:focus {
    border-color: var(--signal-info);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  select:disabled {
    color: var(--text-40);
  }

  .control-plane-warning {
    border-left: 1px solid var(--signal-warn);
    padding-left: var(--space-3);
  }

  .btn-command,
  .btn-confirm,
  .btn-cancel {
    border: 1px solid var(--line-soft);
    border-radius: var(--space-1);
    cursor: pointer;
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  .btn-command,
  .btn-confirm {
    background: var(--signal-info);
    color: var(--surface-root);
    font-weight: var(--fw-medium);
  }

  .btn-risk {
    background: var(--signal-risk);
  }

  .btn-cancel {
    background: var(--surface-raised);
    color: var(--text-80);
  }

  .btn-command:disabled,
  .btn-confirm:disabled,
  .btn-cancel:disabled {
    background: var(--surface-raised);
    color: var(--text-40);
    cursor: not-allowed;
  }

  .confirm-details {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    color: var(--text-60);
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-2);
  }

  .command-result {
    margin: 0;
  }

  .command-result div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .command-result dd {
    margin: 0;
    word-break: break-word;
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

    .profile-command-actions,
    .command-result {
      grid-template-columns: 1fr;
    }

    .command-header-block,
    .command-confirm {
      flex-direction: column;
    }
  }
</style>
