<script lang="ts">
  import { page } from '$app/state'
  import { onMount, onDestroy } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import NetworkDetailPanel from '$lib/components/modules/network/NetworkDetailPanel.svelte'
  import DataplaneStatusPanel from '$lib/components/modules/network/DataplaneStatusPanel.svelte'
  import JoinTicketPanel from '$lib/components/modules/network/JoinTicketPanel.svelte'
  import OperationalProgressFeed from '$lib/components/modules/network/OperationalProgressFeed.svelte'
  import CommandWell from '$lib/components/modules/command/CommandWell.svelte'
  import CredentialLifecyclePanel from '$lib/components/modules/network/CredentialLifecyclePanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'
  import type { NetworkRuntimeTruth } from '$lib/types.ts'

  const stateSources = ['authoritative', 'event', 'log', 'read-model', 'policy']
  const networkId = $derived(page.params.id)

  const runtimeTruth = $derived<NetworkRuntimeTruth | null>(
    appState.networkRuntimeState?.runtimeTruth ?? null
  )
  const profileState = $derived(runtimeTruth?.profile ?? null)
  const netbirdProcess = $derived(runtimeTruth?.netbirdProcess ?? null)
  const packetProof = $derived(runtimeTruth?.packetProof ?? null)
  const secretProvider = $derived(runtimeTruth?.secretProvider ?? null)
  const repairActions = $derived(runtimeTruth?.repairActions ?? [])
  const policyEligibility = $derived(appState.networkRuntimeState?.policyEligibility ?? null)

  const profileEnableCommand = $derived(
    policyEligibility?.commands.find((c) => c.commandId === 'network.profile.enable.execute') ?? null
  )

  function profileStateLabel(state: string): string {
    if (state === 'enabled') return '已启用'
    if (state === 'disabled') return '已禁用'
    if (state === 'degraded') return '已降级'
    return state
  }

  function profileStateTone(state: string): string {
    if (state === 'enabled') return 'var(--signal-ok)'
    if (state === 'disabled') return 'var(--signal-block)'
    return 'var(--signal-warn)'
  }

  function netbirdObservedLabel(observed: string): string {
    if (observed === 'running') return '运行中'
    if (observed === 'stopped') return '已停止'
    if (observed === 'not-run') return '未运行'
    return '未知'
  }

  function netbirdDesiredLabel(desired: string): string {
    if (desired === 'running') return '运行'
    if (desired === 'stopped') return '停止'
    return '未知'
  }

  function packetProofLabel(status: string): string {
    if (status === 'success') return '可达'
    if (status === 'failure') return '不可达'
    return '未执行'
  }

  function secretProviderLabel(status: string): string {
    if (status === 'resolved') return '已就绪'
    if (status === 'missing') return '凭证缺失'
    if (status === 'denied') return '访问被拒'
    return status
  }

  function repairGuidance(reasonCode: string | undefined, message: string | undefined): string {
    switch (reasonCode) {
      case 'missing_permission':
        return `缺少权限，无法发起修复命令。请联系管理员授予对应权限后重试。${message ? `（${message}）` : ''}`
      case 'migration_required':
        return `配置文件存在不兼容变更，需先完成 Profile 迁移后再执行修复。请在 [Profile 迁移] 页面执行迁移任务。`
      case 'missing_secret_provider':
        return `SecretProvider 不可用，凭证材料无法注入。请检查 HashiCorp Vault / 环境变量映射配置是否可达。`
      case 'stale_jwks':
        return `JWKS 缓存已过期，认证令牌无法校验。请刷新会话或检查 OIDC 提供者状态。`
      case 'missing_signal_relay':
        return `Signal/Relay 端点不可达，NetBird 数据面无法建连。请检查 Signal/Relay 配置与网络可达性。`
      default:
        return message ?? '请检查网络状态、中继可达性及密钥提供者状态后重试。'
    }
  }

  async function refreshAll() {
    if (networkId) {
      await Promise.all([
        appState.fetchNetworkDetail(networkId),
        appState.fetchJoinTickets(networkId),
        appState.fetchOperationalState(networkId),
        appState.fetchNetworkRuntimeState(networkId)
      ])
    }
  }

  let stopPolling: (() => void) | null = null

  onMount(() => {
    if (networkId) {
      void appState.fetchNetworkDetail(networkId)
      void appState.fetchJoinTickets(networkId)
      void appState.fetchOperationalState(networkId)
      stopPolling = appState.startNetworkRuntimeStatePolling(networkId)
    }
  })

  onDestroy(() => {
    stopPolling?.()
    appState.stopNetworkRuntimeStatePolling()
  })
</script>

<svelte:head>
  <title>网络详情 | Meristem</title>
</svelte:head>

<section class="network-detail-page">
  <RouteHeader routeName="网络详情" {stateSources} />

  {#if appState.selectedNetworkLoading}
    <section class="empty-panel">
      <p>正在加载网络详情...</p>
    </section>
  {:else if appState.selectedNetworkError}
    <section class="empty-panel error">
      <p>{appState.selectedNetworkError}</p>
    </section>
  {:else if appState.selectedNetwork}
    <!-- 阶段 1：创建 / 选择 -->
    <section class="panel workbench-panel stage" id="stage-create-select" data-testid="stage-create-select">
      <div class="stage-header">
        <span class="stage-marker">1</span>
        <div class="stage-title-block">
          <h3>创建 / 选择网络</h3>
          <p class="stage-hint">选择或创建目标网络，作为管理循环的起点。</p>
        </div>
      </div>
      <NetworkDetailPanel networkData={appState.selectedNetwork} />
    </section>

    <!-- 阶段 2：配置 -->
    <section class="panel workbench-panel stage" id="stage-configure" data-testid="stage-configure">
      <div class="stage-header">
        <span class="stage-marker">2</span>
        <div class="stage-title-block">
          <h3>配置网络</h3>
          <p class="stage-hint">查看数据面配置、网络地图与成员拓扑。</p>
        </div>
      </div>
      <DataplaneStatusPanel
        statusData={appState.selectedNetwork.dataPlaneStatus}
        mapSummary={appState.selectedNetwork.networkMapSummary}
      />
    </section>

    <!-- 阶段 3：启用 -->
    <section class="panel workbench-panel stage" id="stage-enable" data-testid="stage-enable">
      <div class="stage-header">
        <span class="stage-marker">3</span>
        <div class="stage-title-block">
          <h3>启用 Profile</h3>
          <p class="stage-hint">通过 CommandWell 启用 v0.3 Profile；BFF 仅展示策略资格，最终授权由 M-Policy 决定。</p>
        </div>
      </div>

      {#if appState.networkRuntimeStateLoading && !runtimeTruth}
        <p class="loading-line">正在加载运行态...</p>
      {:else if appState.networkRuntimeStateError}
        <InlineOperationalAlert severity="block" message={appState.networkRuntimeStateError} />
        <button class="refresh-btn" onclick={refreshAll}>重试</button>
      {:else if profileState}
        <div class="enable-grid" data-testid="enable-grid">
          <div class="enable-row">
            <span class="enable-key">Profile 启用状态</span>
            <span
              class="enable-value"
              style:--tone={profileStateTone(profileState.state)}
              data-testid="profile-enable-state"
            >
              {profileStateLabel(profileState.state)}
            </span>
            {#if profileState.reason}
              <span class="enable-reason" data-testid="profile-enable-reason">{profileState.reason}</span>
            {/if}
            <StateSourceBadge source={profileState.stateSource.sourceType} />
          </div>
          {#if profileEnableCommand}
            <div class="enable-row" data-testid="profile-enable-eligibility">
              <span class="enable-key">启用命令资格</span>
              <span
                class="enable-value"
                style:--tone={profileEnableCommand.state === 'enabled' ? 'var(--signal-ok)' : 'var(--signal-block)'}
              >
                {profileEnableCommand.state === 'enabled' ? '可执行' : '已禁用'}
              </span>
              {#if profileEnableCommand.state === 'disabled' && profileEnableCommand.disabledReason}
                <span class="enable-reason" data-testid="profile-enable-disabled-reason">
                  {profileEnableCommand.disabledReason.message}
                </span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- 阶段 4：观察 -->
    <section class="panel workbench-panel stage" id="stage-observe" data-testid="stage-observe">
      <div class="stage-header">
        <span class="stage-marker">4</span>
        <div class="stage-title-block">
          <h3>观察运行态</h3>
          <p class="stage-hint">对照 desired / observed NetBird 状态、凭证生命周期与部署进度。</p>
        </div>
      </div>

      {#if runtimeTruth}
        <div class="observe-grid" data-testid="observe-grid">
          <div class="observe-card" data-testid="observe-netbird-process">
            <div class="observe-card-header">
              <h4>NetBird 进程状态</h4>
              <StateSourceBadge source={netbirdProcess?.stateSource.sourceType ?? 'read-model'} />
            </div>
            <dl class="kv-grid">
              <div><dt>期望态 (desired)</dt><dd class="mono">{netbirdDesiredLabel(netbirdProcess?.desired ?? 'unknown')}</dd></div>
              <div><dt>观测态 (observed)</dt><dd class="mono">{netbirdObservedLabel(netbirdProcess?.observed ?? 'unknown')}</dd></div>
              <div><dt>健康度</dt><dd class="mono" style:--tone={netbirdProcess?.status === 'healthy' ? 'var(--signal-ok)' : 'var(--signal-warn)'}>{netbirdProcess?.status === 'healthy' ? '健康' : '已降级'}</dd></div>
            </dl>
            <p class="observe-summary">{netbirdProcess?.summary ?? '—'}</p>
            {#if netbirdProcess?.nodes.length}
              <table class="node-table">
                <thead>
                  <tr><th>节点</th><th>期望</th><th>观测</th><th>状态</th><th>详情</th></tr>
                </thead>
                <tbody>
                  {#each netbirdProcess.nodes as node}
                    <tr data-testid="netbird-process-node-{node.nodeId}">
                      <td class="mono">{node.nodeId}</td>
                      <td class="mono">{netbirdDesiredLabel(node.desired)}</td>
                      <td class="mono">{netbirdObservedLabel(node.observed)}</td>
                      <td class="mono" style:--tone={node.status === 'healthy' ? 'var(--signal-ok)' : 'var(--signal-warn)'}>{node.status === 'healthy' ? '健康' : '已降级'}</td>
                      <td>{node.detail}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>

          <div class="observe-card" data-testid="observe-packet-proof">
            <div class="observe-card-header">
              <h4>数据包可达性证明</h4>
              <StateSourceBadge source={packetProof?.stateSource.sourceType ?? 'read-model'} />
            </div>
            <dl class="kv-grid">
              <div><dt>证明结果</dt><dd class="mono" style:--tone={packetProof?.status === 'success' ? 'var(--signal-ok)' : packetProof?.status === 'failure' ? 'var(--signal-block)' : 'var(--text-60)'}>{packetProofLabel(packetProof?.status ?? 'not-run')}</dd></div>
              {#if packetProof?.source}<div><dt>源</dt><dd class="mono">{packetProof.source}</dd></div>{/if}
              {#if packetProof?.target}<div><dt>目标</dt><dd class="mono">{packetProof.target}</dd></div>{/if}
              {#if packetProof?.probe}<div><dt>探测类型</dt><dd class="mono">{packetProof.probe}</dd></div>{/if}
              {#if packetProof?.targetOverlayIp}<div><dt>目标 Overlay IP</dt><dd class="mono">{packetProof.targetOverlayIp}</dd></div>{/if}
            </dl>
            <p class="observe-summary">{packetProof?.summary ?? '—'}</p>
          </div>

          <div class="observe-card" data-testid="observe-secret-provider">
            <div class="observe-card-header">
              <h4>SecretProvider 状态</h4>
              <StateSourceBadge source={secretProvider?.stateSource.sourceType ?? 'read-model'} />
            </div>
            <dl class="kv-grid">
              <div><dt>状态</dt><dd class="mono" style:--tone={secretProvider?.status === 'resolved' ? 'var(--signal-ok)' : 'var(--signal-block)'}>{secretProviderLabel(secretProvider?.status ?? 'unknown')}</dd></div>
            </dl>
            <p class="observe-summary">{secretProvider?.summary ?? '—'}</p>
          </div>
        </div>
      {:else if !appState.networkRuntimeStateError}
        <p class="loading-line">正在加载运行态...</p>
      {/if}

      <div class="observe-subsection" id="network-credential-lifecycle">
        <h4>凭证生命周期</h4>
        <CredentialLifecyclePanel operationalState={appState.operationalState} />
      </div>

      <div class="observe-subsection" id="network-operational-progress">
        <h4>运营与部署进度</h4>
        {#if appState.operationalStateLoading && !appState.operationalState}
          <p class="loading-line">正在加载运营状态...</p>
        {:else if appState.operationalStateError}
          <InlineOperationalAlert severity="block" message={appState.operationalStateError} />
          <button class="refresh-btn" style="margin-top: var(--space-2);" onclick={refreshAll}>重试</button>
        {:else}
          <OperationalProgressFeed
            operationalState={appState.operationalState}
            onRefresh={refreshAll}
            refreshing={appState.operationalStateLoading}
          />
        {/if}
      </div>
    </section>

    <!-- 阶段 5：修复 -->
    <section class="panel workbench-panel stage" id="stage-repair" data-testid="stage-repair">
      <div class="stage-header">
        <span class="stage-marker">5</span>
        <div class="stage-title-block">
          <h3>修复</h3>
          <p class="stage-hint">通过 CommandWell 触发受支持的修复命令；禁用态会展示具体修复指导。</p>
        </div>
      </div>

      {#if repairActions.length > 0}
        <div class="repair-list" data-testid="repair-list">
          {#each repairActions as action}
            <div class="repair-row" data-testid="repair-action-{action.commandId}">
              <div class="repair-row-main">
                <span class="mono repair-command-id">{action.commandId}</span>
                <span
                  class="repair-state"
                  style:--tone={action.state === 'enabled' ? 'var(--signal-ok)' : 'var(--signal-block)'}
                >
                  {action.state === 'enabled' ? '可执行' : '已禁用'}
                </span>
                <StateSourceBadge source={action.stateSource.sourceType} />
              </div>
              {#if action.state === 'disabled' && action.disabledReason}
                <p class="repair-guidance" data-testid="repair-guidance-{action.commandId}">
                  {repairGuidance(action.disabledReason.code, action.disabledReason.message)}
                </p>
              {/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="loading-line">暂无可用修复命令。</p>
      {/if}

      <div class="observe-subsection">
        <h4>Join Tickets</h4>
        <JoinTicketPanel networkId={networkId} ticketsData={appState.joinTickets} />
      </div>
    </section>

  {:else}
    <section class="empty-panel workbench-panel">
      <p>未找到网络：<span class="mono">{networkId}</span></p>
    </section>
  {/if}
</section>

<div class="command-region">
  <CommandWell
    commandState={appState.commandState}
    commandStateError={appState.commandStateError}
    selectedNode={appState.selectedNode}
    confirming={appState.commandConfirming}
    emptyStateText="请在面板中验证操作资格"
    targetLabel="网络 ID"
    targetName={networkId}
    onRequestConfirm={() => appState.commandConfirming = true}
    onCancel={() => appState.commandConfirming = false}
    onConfirm={async () => {
      if (appState.commandState?.command?.id === 'network.forced-relay.change.execute' && appState.selectedNodeId) {
        appState.commandParams = {
          nodeId: appState.selectedNodeId,
          reason: 'network detail forced relay change'
        }
      }
      await appState.executeGenericCommand()
      if (networkId) {
        void appState.fetchJoinTickets(networkId)
        void appState.fetchNetworkDetail(networkId)
        void appState.fetchOperationalState(networkId)
        void appState.fetchNetworkRuntimeState(networkId)
      }
    }}
  />
</div>

<style>
  .network-detail-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
    margin-bottom: 120px;
  }

  .panel,
  .empty-panel {
    min-width: 0;
  }

  .panel {
    gap: var(--space-4);
  }

  h3 {
    color: var(--text-100);
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    margin: 0;
  }

  h4 {
    color: var(--text-100);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    margin: 0;
  }

  .empty-panel {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .empty-panel.error {
    color: var(--signal-warn);
    border-color: var(--signal-warn);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .loading-line {
    color: var(--text-60);
    font-size: var(--text-sm);
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stage-header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
  }

  .stage-marker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-pill);
    border: 1px solid color-mix(in srgb, var(--signal-info) 40%, var(--line-soft));
    background: color-mix(in srgb, var(--signal-info) 12%, transparent);
    color: var(--signal-info);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
  }

  .stage-title-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .stage-hint {
    color: var(--text-60);
    font-size: var(--text-xs);
    margin: 0;
  }

  .enable-grid,
  .observe-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .enable-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  .enable-key {
    color: var(--text-60);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .enable-value {
    color: var(--tone, var(--text-100));
    font-weight: var(--fw-semibold);
    font-size: var(--text-sm);
  }

  .enable-reason {
    color: var(--signal-block);
    font-size: var(--text-xs);
    border: 1px solid color-mix(in srgb, var(--signal-block) 40%, var(--line-soft));
    border-radius: var(--control-radius);
    padding: 1px var(--space-2);
  }

  .observe-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  .observe-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .kv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
    margin: 0;
  }

  .kv-grid dt {
    color: var(--text-60);
    font-size: var(--text-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
  }

  .kv-grid dd {
    color: var(--tone, var(--text-100));
    font-size: var(--text-sm);
    margin: var(--space-1) 0 0;
    word-break: break-all;
  }

  .observe-summary {
    color: var(--text-60);
    font-size: var(--text-xs);
    margin: 0;
  }

  .node-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
    text-align: left;
  }

  .node-table th,
  .node-table td {
    padding: var(--space-1) var(--space-2);
    border-bottom: 1px solid var(--line-soft);
  }

  .node-table th {
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  .node-table td[style*="--tone"] {
    color: var(--tone);
  }

  .observe-subsection {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .repair-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .repair-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line-soft);
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--surface-root) 60%, var(--surface-panel));
  }

  .repair-row-main {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }

  .repair-command-id {
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  .repair-state {
    color: var(--tone, var(--text-100));
    font-size: var(--text-xs);
    font-weight: var(--fw-semibold);
  }

  .repair-guidance {
    color: var(--signal-block);
    font-size: var(--text-xs);
    margin: 0;
  }

  .refresh-btn {
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--surface-root);
    border: 1px solid var(--line-strong);
    border-radius: var(--control-radius);
    color: var(--text-100);
    cursor: pointer;
    font-size: var(--text-xs);
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

  @media (max-width: 760px) {
    .command-region {
      left: 0;
    }
  }
</style>