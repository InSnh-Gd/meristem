<script lang="ts">
  import type { OperationalStateData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  type CredentialNode = NonNullable<OperationalStateData['credentials']>['nodes'][number]

  let { operationalState } = $props<{
    operationalState: OperationalStateData | null
  }>()

  const credentials = $derived(operationalState?.credentials ?? null)
  const nodes = $derived(credentials?.nodes ?? [])
  const expiredNode = $derived(nodes.find((node: CredentialNode) => node.credentialStatus === 'expired') ?? null)
  const missingNode = $derived(nodes.find((node: CredentialNode) => node.credentialStatus === 'missing') ?? null)

  function statusColor(status: string): string {
    switch (status) {
      case 'ready': return 'var(--signal-ok)'
      case 'pending': return 'var(--signal-info)'
      case 'rotation_required': return 'var(--signal-warn)'
      case 'expired': return 'var(--signal-block)'
      case 'missing': return 'var(--signal-block)'
      default: return 'var(--text-40)'
    }
  }

  function formatTime(ts: string | undefined): string {
    if (!ts) return '永不过期'
    try {
      return new Date(ts).toLocaleString('zh-CN', { hour12: false })
    } catch {
      return '—'
    }
  }
</script>

<div class="credential-lifecycle-card">
  <div class="card-header">
    <div class="title-block">
      <h4>凭证生命周期与托管状态</h4>
      {#if credentials}
        <StateSourceBadge source={operationalState?.stateSource.sourceType ?? 'read-model'} />
      {/if}
    </div>
    {#if credentials}
      <span class="overall-badge" style:--status-color={statusColor(credentials.status === 'healthy' ? 'ready' : credentials.status)}>
        {credentials.status === 'healthy' ? '正常' : credentials.status === 'degraded' ? '已降级' : '已阻断'}
      </span>
    {/if}
  </div>

  {#if !credentials || nodes.length === 0}
    <div class="empty-state">
      <p>当前网络无 Sidecar 凭证管理需求或数据为空。</p>
    </div>
  {:else}
    <div class="table-container">
      <table class="credential-table">
        <thead>
          <tr>
            <th>节点 ID</th>
            <th>凭证状态</th>
            <th>提供商 (Provider)</th>
            <th>密钥路径 (KeyPath)</th>
            <th>版本 (Version)</th>
            <th>过期时间</th>
          </tr>
        </thead>
        <tbody>
          {#each nodes as node}
            <tr class="node-row" data-testid="cred-row-{node.nodeId}">
              <td class="mono font-semibold">{node.nodeId}</td>
              <td>
                <span class="status-indicator" style:--status-color={statusColor(node.credentialStatus)}>
                  {node.credentialStatus === 'ready' ? '已就绪 (Ready)' : node.credentialStatus === 'pending' ? '分配中 (Pending)' : node.credentialStatus === 'rotation_required' ? '需轮换 (Rotate)' : node.credentialStatus === 'expired' ? '已过期 (Expired)' : '缺失 (Missing)'}
                </span>
              </td>
              <td class="mono">{node.credentialRef?.provider ?? '—'}</td>
              <td class="mono truncate-cell" title={node.credentialRef?.keyPath}>{node.credentialRef?.keyPath ?? '—'}</td>
              <td class="mono">{node.credentialRef?.version !== undefined ? `v${node.credentialRef.version}` : '—'}</td>
              <td class="mono" class:expired-text={node.credentialStatus === 'expired'}>
                {formatTime(node.expiresAt)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="footer-actions">
      <p class="security-notice">
        🛡️ <b>安全提示:</b> 凭证明文已在服务边界受控脱敏，控制台仅展示 <code>SecretRef</code> 元数据，绝对不泄露私钥与明文令牌。
      </p>
      {#if credentials.status !== 'healthy'}
        <div class="recovery-box" data-testid="cred-recovery-box">
          <h5>🔑 凭证恢复指南 (Credential Recovery Guidance)</h5>
          {#if expiredNode}
            <p>检测到有节点的 Sidecar 凭证已过期，请前往 <b><a href="/nodes/{expiredNode.nodeId}/credentials">节点凭证</a></b> 页面，选择操作类型为 <b>[轮换凭证 (Rotate)]</b> 重新为节点注入有效授权。</p>
          {:else if missingNode}
            <p>检测到有节点的 Sidecar 凭证缺失，请前往 <b><a href="/nodes/{missingNode.nodeId}/credentials">节点凭证</a></b> 页面，选择操作类型为 <b>[颁发凭证 (Issue)]</b> 颁发证书凭证。</p>
          {:else}
            <p>SecretProvider 处于降级状态或网络异常。若为提供商不可用，请确保 HashiCorp Vault / 环境变量映射配置可达，并点击上方刷新重试。</p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
