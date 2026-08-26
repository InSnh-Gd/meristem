<script lang="ts">
  import { page } from '$app/state'
  import { onMount } from 'svelte'
  import GlobalProfileControls from '$lib/components/modules/network/GlobalProfileControls.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import NetworkProfileDetailPanel from '$lib/components/modules/network/NetworkProfileDetailPanel.svelte'
  import RawEnvelopeView from '$lib/components/ui/RawEnvelopeView.svelte'
  import OperationalCommandPreview from '$lib/components/modules/policy/OperationalCommandPreview.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import NetworkProfileCommandWellZone, {
    type ProfileCommandKind
  } from './NetworkProfileCommandWellZone.svelte'
  import NetworkProfileGatedPreview from './NetworkProfileGatedPreview.svelte'
  import NetworkProfileTargetSelectorZone from './NetworkProfileTargetSelectorZone.svelte'
  import { bffFetch, executeCommand, formatBffError } from '$lib/bff.ts'
  import { appState as muiStores } from '$lib/stores.svelte.ts'
  import type { NetworkListResponseData, ProfileCommandResult } from '$lib/types.ts'

  /**
   * Network Profile 详情工作台外壳。
   *
   * 结构职责划分（M-UI Transitional Workbench）：本组件只保留页面骨架、
   * 标题块、降级/错误提示、数据获取与状态流转编排。
   * 各 zone 的具体渲染下沉到共址子组件，通过显式 typed props 传值：
   *
   * - NetworkProfileDetailPanel         Profile 详情与能力摘要
   * - GlobalProfileControls             全局 Profile 控制与切换
   * - NetworkProfileTargetSelectorZone  目标网络选择器（权威事实前置门禁）
   * - NetworkProfileCommandPreviewZone  Profile 命令只读预览
   * - NetworkProfileCommandWellZone     Profile CommandWell 启停操作井与确认门禁
   * - NetworkProfileGatedPreview        未授权访问边界说明与预览
   *
   * 归属边界：M-UI 只拥有 UI 结构与确认流程。事实与策略决策归属 M-Net / M-Policy，
   * 经 M-UI BFF 适配后进入本组件。命令提交始终携带显式 networkId 并通过 BFF 执行端点。
   */
  const stateSources = ['authoritative', 'policy', 'audit', 'log']
  const profileVersion = $derived(page.params.profileVersion)
  const profilePreviewReason =
    '只读预览，实际执行需通过下方 CommandWell 选择目标网络并确认执行'

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
        <NetworkProfileTargetSelectorZone
          {networks}
          bind:selectedNetworkId
          {networksLoading}
          {networksError}
        />
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
        <NetworkProfileCommandWellZone
          {selectedNetworkId}
          selectedNetworkName={selectedNetwork?.name ?? null}
          {pendingProfileCommand}
          {commandRunning}
          {commandError}
          {commandResult}
          onRequestCommand={requestProfileCommand}
          onConfirmCommand={confirmProfileCommand}
          onCancelCommand={cancelProfileCommand}
        />
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
    <NetworkProfileGatedPreview {profileVersion} />
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

  .preview-zone {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .command-deck {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 10px;
  }

  .zone-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 1px var(--space-1);
    border-radius: var(--radius-xs);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    line-height: var(--lh-tight);
    color: var(--text-60);
    background: color-mix(in srgb, var(--text-60) 12%, var(--surface-raised));
  }

  .status-badge::before {
    content: '';
    width: var(--space-1);
    height: var(--space-1);
    border-radius: var(--radius-pill);
    background: currentColor;
  }

  .raw-panel,
  .empty-panel {
    min-width: 0;
  }

  .raw-panel {
    position: sticky;
    top: var(--space-4);
    align-self: start;
    max-height: calc(100vh - var(--app-bar-height) - var(--space-6));
    overflow-y: auto;
    padding: var(--space-3);
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
</style>
