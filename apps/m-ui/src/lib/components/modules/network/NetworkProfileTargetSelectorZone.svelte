<script lang="ts">
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import type { NetworkListResponseData } from '$lib/types.ts'

  /**
   * Zone 边界：Profile 目标网络选择面板（Orientation / Authoritative Fact Selection）。
   *
   * 归属：M-UI 拥有选择器交互与状态展示。目标网络列表由 M-UI BFF 适配提供，
   * 权威事实归属 M-Net 功能域服务。选择结果作为前置门禁绑定至 CommandWell。
   */
  let {
    networks,
    selectedNetworkId = $bindable(''),
    networksLoading = false,
    networksError = null
  } = $props<{
    networks: NetworkListResponseData['networks']
    selectedNetworkId?: string
    networksLoading?: boolean
    networksError?: string | null
  }>()
</script>

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

<style>
  .network-target-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
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

  .zone-eyebrow {
    color: var(--text-60);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0;
  }

  .network-select-label,
  .control-plane-warning {
    font-size: var(--text-sm);
    line-height: var(--lh-log);
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
    color: var(--text-100);
    border-left: 1px solid var(--signal-warn);
    padding-left: var(--space-3);
    margin: 0;
  }
</style>
