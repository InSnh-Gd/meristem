<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import GlobalProfileControls from '$lib/components/modules/network/GlobalProfileControls.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import NetworkProfileDetailPanel from '$lib/components/modules/network/NetworkProfileDetailPanel.svelte'
  import RawEnvelopeView from '$lib/components/ui/RawEnvelopeView.svelte'
  import OperationalCommandPreview from '$lib/components/modules/policy/OperationalCommandPreview.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import { bffFetch, executeCommand, formatBffError } from '$lib/bff.ts'
  import { appState as muiStores } from '$lib/stores.svelte.ts'
  import type { NetworkListResponseData, ProfileCommandResult } from '$lib/types.ts'

  const PROFILE_ICONS: Record<string, string> = {
    profile:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5z" fill="currentColor" fill-opacity="0.12"/><path d="M4 13a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2z" fill="currentColor" fill-opacity="0.12"/><path d="M8 8h8"/><path d="M8 16h8"/></svg>',
    network:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.5" fill="currentColor" fill-opacity="0.18"/><circle cx="6" cy="18" r="2.5" fill="currentColor" fill-opacity="0.18"/><circle cx="18" cy="18" r="2.5" fill="currentColor" fill-opacity="0.18"/><path d="m11 7-4 9"/><path d="m13 7 4 9"/><path d="M7.5 15h9"/></svg>',
    command:
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" fill="currentColor" fill-opacity="0.12"/><path d="m9 8 5 4-5 4z" fill="currentColor" stroke="none"/></svg>'
  }

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

  /** 通过 M-UI BFF 读取网络列表，前端不直接访问 Core public facade 或功能域服务。 */
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
		const targetProfileVersion = kind === 'enable' ? 'm-net-cn@0.3.0' : 'm-net@0.3.0'

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

  <div class="page-title-block">
    <div class="page-titles">
      <h2 class="page-eyebrow">Network profile</h2>
      <h1 id="network-profile-detail-title" class="page-title">Profile 详情</h1>
      <p class="page-subtitle">观察 Profile 版本、能力、目标网络与只读命令预览。</p>
    </div>
    <div class="page-meta">
      <span class="status-badge">profile: {profileVersion}</span>
    </div>
  </div>

  {#if muiStores.selectedProfileError}
    <InlineOperationalAlert message={muiStores.selectedProfileError} severity="block" />
  {/if}

  {#if muiStores.selectedProfileLoading}
    <section class="zone-panel empty-panel">
      <p class="workbench-empty">正在加载 Profile 详情。</p>
    </section>
  {:else if muiStores.selectedProfile}
    <div class="profile-layout">
      <div class="workspace-zones">
        <NetworkProfileDetailPanel profile={muiStores.selectedProfile} />
        <GlobalProfileControls {profileVersion} />

        <section class="zone-panel network-target-panel" aria-labelledby="network-target-title">
          <div class="zone-header">
            <div class="zone-titles">
              <span class="zone-eyebrow">Target network</span>
              <h3 id="network-target-title">选择 Profile 命令目标</h3>
            </div>
            <span class="meta-chip">authoritative</span>
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
            <p class="workbench-empty">正在加载目标网络。</p>
          {:else if networks.length === 0}
            <p class="workbench-empty">暂无可选目标网络。</p>
          {/if}
        </section>

        <!-- Profile 只读预览：保留操作元数据可见性 -->
        <section class="zone-panel preview-zone" aria-labelledby="preview-title">
          <div class="zone-header">
            <div class="zone-titles">
              <span class="zone-eyebrow">Command preview</span>
              <h3 id="preview-title">Profile 命令预览</h3>
            </div>
          </div>
          <div class="command-deck">
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
          </div>
        </section>

        <section class="zone-panel command-zone" aria-label="Profile CommandWell">
          <div class="zone-header">
            <div class="zone-titles">
              <span class="zone-eyebrow">CommandWell</span>
              <h3>Profile 启停命令</h3>
            </div>
            <span class="status-badge ready">high risk</span>
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

          <div class="command-deck">
			<article class="command-card primary" class:confirming={pendingProfileCommand === 'enable'}>
				<div class="command-card-title">
					<span class="command-card-icon" aria-hidden="true">{@html PROFILE_ICONS.profile}</span>
					启用 m-net-cn@0.3.0
				</div>
              <div class="command-card-target">target: {selectedNetworkId ? selectedNetwork?.name ?? selectedNetworkId : missingNetworkReason}</div>
              <div class="command-card-requirements">
                <span>requires: network:profile-enable</span>
                <span>policy: required</span>
                <span>audit: required</span>
              </div>
              {#if pendingProfileCommand === 'enable'}
                <div class="command-card-status attention">
                  <span class="confirm-label">状态: 需要确认</span>
                  <div class="confirm-actions">
                    <button type="button" class="btn-execute primary" disabled={commandRunning} onclick={confirmProfileCommand}>确认执行</button>
                    <button type="button" class="btn-execute" disabled={commandRunning} onclick={cancelProfileCommand}>取消</button>
                  </div>
                </div>
              {:else}
                <div class="command-card-status {selectedNetworkId ? 'ready' : 'block'}">
                  状态: {selectedNetworkId ? '就绪' : '禁用'}
                  {#if selectedNetworkId}
                    <button type="button" class="btn-execute primary" onclick={() => requestProfileCommand('enable')}>执行</button>
                  {:else}
                    <span class="command-reason">{missingNetworkReason}</span>
                  {/if}
                </div>
              {/if}
            </article>

			<article class="command-card primary" class:confirming={pendingProfileCommand === 'disable'}>
				<div class="command-card-title">
					<span class="command-card-icon" aria-hidden="true">{@html PROFILE_ICONS.profile}</span>
					停用并恢复 m-net@0.3.0
				</div>
              <div class="command-card-target">target: {selectedNetworkId ? selectedNetwork?.name ?? selectedNetworkId : missingNetworkReason}</div>
              <div class="command-card-requirements">
                <span>requires: network:profile-disable</span>
                <span>policy: required</span>
                <span>audit: required</span>
              </div>
              {#if pendingProfileCommand === 'disable'}
                <div class="command-card-status attention">
                  <span class="confirm-label">状态: 需要确认</span>
                  <div class="confirm-actions">
                    <button type="button" class="btn-execute primary" disabled={commandRunning} onclick={confirmProfileCommand}>确认执行</button>
                    <button type="button" class="btn-execute" disabled={commandRunning} onclick={cancelProfileCommand}>取消</button>
                  </div>
                </div>
              {:else}
                <div class="command-card-status {selectedNetworkId ? 'ready' : 'block'}">
                  状态: {selectedNetworkId ? '就绪' : '禁用'}
                  {#if selectedNetworkId}
                    <button type="button" class="btn-execute primary" onclick={() => requestProfileCommand('disable')}>执行</button>
                  {:else}
                    <span class="command-reason">{missingNetworkReason}</span>
                  {/if}
                </div>
              {/if}
            </article>
          </div>

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

      <aside class="raw-panel zone-panel" aria-label="Profile 原始数据">
        <div class="zone-header">
          <div class="zone-titles">
            <span class="zone-eyebrow">Raw envelope</span>
            <h3>原始 Profile 数据</h3>
          </div>
        </div>
        <RawEnvelopeView title="原始 Profile 数据" data={muiStores.selectedProfile} />
      </aside>
    </div>
  {:else}
    <div class="profile-layout gated-profile-layout">
      <div class="workspace-zones">
        <section class="zone-panel empty-panel gated-profile-panel" aria-label="Profile gated preview">
          <div class="zone-header">
            <div class="zone-titles">
              <span class="zone-eyebrow">Network profile</span>
              <h3>Profile 需要授权加载</h3>
            </div>
            <span class="status-badge">gated</span>
          </div>
          <div class="summary-card-grid compact-preview-grid">
            <article class="summary-card core-health">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html PROFILE_ICONS.profile}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">目标 Profile</div>
                <div class="summary-card-value">{profileVersion}</div>
                <div class="summary-card-chips">
                  <span class="meta-chip">stateSource: gated</span>
                </div>
              </div>
              <div class="summary-card-footer"><span class="summary-card-footer-left">需要 Bearer JWT</span></div>
            </article>
            <article class="summary-card event-bus">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html PROFILE_ICONS.network}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">目标网络</div>
                <div class="summary-card-value">pending auth</div>
                <div class="summary-card-chips">
                  <span class="meta-chip">network list gated</span>
                </div>
              </div>
              <div class="summary-card-footer"><span class="summary-card-footer-left">Profile 命令必须显式选择网络</span></div>
            </article>
            <article class="summary-card audit-visibility">
              <div class="summary-card-glow-icon" aria-hidden="true">{@html PROFILE_ICONS.command}</div>
              <div class="summary-card-main">
                <div class="summary-card-title">命令预览</div>
                <div class="summary-card-value">read-only</div>
                <div class="summary-card-chips">
                  <span class="meta-chip">confirm required</span>
                </div>
              </div>
              <div class="summary-card-footer"><span class="summary-card-footer-left">不会在无授权状态执行切换</span></div>
            </article>
          </div>
        </section>
      </div>
      <aside class="raw-panel zone-panel" aria-label="Profile gated context">
        <div class="zone-header">
          <div class="zone-titles">
            <span class="zone-eyebrow">Selected context</span>
            <h3>未加载 Profile</h3>
          </div>
        </div>
        <div class="inspector-section">
          <span class="inspector-section-title">访问边界</span>
          <div class="inspector-row">
            <span class="inspector-key">profileVersion</span>
            <span class="inspector-value">{profileVersion}</span>
          </div>
          <div class="inspector-row">
            <span class="inspector-key">required</span>
            <span class="inspector-value">Bearer JWT</span>
          </div>
        </div>
      </aside>
    </div>
  {/if}
</section>

<style>
  .route-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .page-title-block {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-1);
  }

  .page-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .page-title {
    color: var(--text-100);
    font-size: var(--text-2xl);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    letter-spacing: -0.01em;
    margin: 0;
  }

  .page-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.06em;
    margin: 0;
  }

  .page-subtitle {
    color: var(--text-60);
    font-size: var(--text-sm);
    margin-top: var(--space-1);
  }

  .page-meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .profile-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--inspector-width);
    gap: var(--panel-gap);
    align-items: start;
  }

  .workspace-zones {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    min-width: 0;
  }

  .zone-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  h3 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .network-target-panel,
  .command-zone,
  .preview-zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .command-zone {
    border-color: color-mix(in srgb, var(--signal-info) 24%, var(--line-soft));
  }

  .network-select-label,
  .command-copy,
  .control-plane-warning,
  .disabled-reason {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
  }

  .network-select-label,
  .command-copy,
  .control-plane-warning {
    color: var(--text-100);
  }

  .network-select-label {
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  select {
    width: 100%;
    border: 1px solid var(--line-soft);
    border-radius: var(--control-radius);
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
    margin: 0;
  }

  .disabled-reason {
    color: var(--signal-warn);
    margin: 0;
  }

  .command-deck {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .command-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    padding: 14px;
    border: 1px solid color-mix(in srgb, var(--line-soft) 86%, transparent);
    border-radius: var(--operational-card-radius);
    background: linear-gradient(180deg, color-mix(in srgb, var(--surface-panel) 94%, var(--surface-raised)), color-mix(in srgb, var(--surface-root) 96%, black));
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--glass-panel-highlight) 24%, transparent);
  }

  .command-card.primary {
    border-color: color-mix(in srgb, var(--line-soft) 86%, transparent);
    background:
      linear-gradient(
        160deg,
        color-mix(in srgb, var(--surface-panel) 94%, var(--surface-raised)),
        var(--surface-panel)
      );
  }

  .command-card.confirming {
    border-color: color-mix(in srgb, var(--signal-attention) 82%, var(--line-soft));
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--signal-attention) 24%, transparent),
      inset 0 1px 0 color-mix(in srgb, var(--signal-attention) 28%, transparent);
  }

  .command-card-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--text-100);
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
  }

  .command-card-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-xs);
    background: var(--surface-chrome-raised);
    color: var(--text-80);
  }

  .command-card-target {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-60);
    font-size: var(--text-xs);
    font-family: var(--font-mono);
  }

  .command-card-requirements {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-60);
    font-size: var(--text-xs);
  }

  .command-card-status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: auto;
    padding-top: var(--space-2);
    border-top: 1px solid var(--line-soft);
    color: var(--text-60);
    font-size: var(--text-xs);
  }

  .command-card.confirming .command-card-status.attention {
    margin-right: -14px;
    margin-bottom: -14px;
    margin-left: -14px;
    padding: var(--space-2) 14px;
    border-top: 1px solid color-mix(in srgb, var(--signal-attention) 34%, var(--line-soft));
    border-radius: 0 0 var(--operational-card-radius) var(--operational-card-radius);
    background: linear-gradient(90deg, color-mix(in srgb, var(--signal-attention) 20%, transparent), color-mix(in srgb, var(--signal-attention) 7%, transparent));
  }

  .command-card-status.ready {
    color: var(--signal-ok);
  }

  .command-card-status.block {
    color: var(--signal-block);
  }

  .command-card-status.attention {
    color: var(--signal-attention);
  }

  .command-reason {
    margin-left: auto;
    border: 1px solid color-mix(in srgb, var(--signal-block) 40%, var(--line-soft));
    border-radius: var(--control-radius);
    color: var(--signal-block);
    font-size: var(--text-xs);
    padding: 1px var(--space-1);
  }

  .confirm-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--signal-warn);
    font-weight: var(--fw-medium);
    letter-spacing: 0.04em;
  }

  .confirm-actions {
    display: flex;
    gap: var(--space-2);
    margin-left: auto;
  }

  .btn-execute {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    margin-left: auto;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line-chrome-strong);
    border-radius: var(--control-radius);
    background: var(--surface-chrome-raised);
    color: var(--text-80);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      background var(--duration-fast) var(--easing-ui),
      color var(--duration-fast) var(--easing-ui);
  }

  .btn-execute:hover:not(:disabled) {
    border-color: var(--signal-info);
    background: var(--surface-raised);
    color: var(--text-100);
  }

  .btn-execute:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-execute.primary {
    border-color: var(--signal-ok);
    background: var(--signal-ok);
    color: var(--surface-root);
  }

  .btn-execute.primary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--signal-ok) 90%, white);
  }

  .command-result {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
    width: 100%;
    margin: 0;
  }

  .command-result > div {
    border: 1px solid color-mix(in srgb, var(--signal-info) 28%, var(--line-soft));
    border-radius: var(--control-radius);
    background: color-mix(in srgb, var(--surface-raised) 60%, var(--surface-root));
    padding: var(--space-2) var(--space-3);
  }

  .command-result dt {
    color: var(--text-60);
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    margin: 0;
    text-transform: uppercase;
  }

  .command-result dd {
    color: var(--text-100);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: var(--lh-tight);
    margin: var(--space-1) 0 0;
    word-break: break-all;
  }

  .raw-panel,
  .empty-panel {
    min-width: 0;
  }

  .gated-profile-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .compact-preview-grid {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }

  .inspector-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--line-soft);
  }

  .inspector-section-title {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .inspector-row {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-xs);
  }

  .inspector-key {
    color: var(--text-60);
  }

  .inspector-value {
    color: var(--text-80);
    font-family: var(--font-mono);
  }

  .raw-panel {
    position: sticky;
    top: var(--space-4);
    align-self: start;
    max-height: calc(100vh - var(--app-bar-height) - var(--space-6));
    overflow-y: auto;
    padding: var(--space-3);
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 1200px) {
    .profile-layout {
      grid-template-columns: 1fr;
    }

    .raw-panel {
      position: static;
      max-height: none;
    }
  }

  @media (max-width: 960px) {
    .page-title-block {
      flex-direction: column;
      align-items: flex-start;
    }
  }

  @media (max-width: 760px) {
    .command-card-status {
      flex-direction: column;
      align-items: flex-start;
    }

    .command-reason,
    .btn-execute {
      margin-left: 0;
    }

    .confirm-actions {
      margin-left: 0;
      width: 100%;
    }

    .command-result {
      grid-template-columns: 1fr;
    }
  }
</style>
