<script lang="ts">
  /**
   * 阶段 4「观察运行态」的运行真相卡片子视图。
   *
   * 所有权边界：本组件只展示 BFF 派生的 runtimeTruth 对照结果
   * （desired / observed NetBird 状态、数据包可达性证明、SecretProvider 状态）。
   * 事实由 M-Net 与凭证提供者拥有，组件不推断、不聚合、不判定健康度，
   * 只把已判定的状态与其 stateSource 一并呈现，保证关键状态可溯源且不只靠颜色表达。
   *
   * 凭证生命周期与运营进度两个子小节仍由路由承载，本组件只覆盖运行真相网格。
   */
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'
  import type { NetworkRuntimeTruth } from '$lib/types.ts'

  type Props = {
    /** BFF runtimeTruth 中的 NetBird 进程对照态。 */
    netbirdProcess: NetworkRuntimeTruth['netbirdProcess'] | null
    /** BFF runtimeTruth 中的数据包可达性证明。 */
    packetProof: NetworkRuntimeTruth['packetProof'] | null
    /** BFF runtimeTruth 中的 SecretProvider 状态。 */
    secretProvider: NetworkRuntimeTruth['secretProvider'] | null
  }

  let { netbirdProcess, packetProof, secretProvider }: Props = $props()

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
</script>

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

<style>
  h4 {
    color: var(--text-100);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
    margin: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  .observe-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
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
</style>
