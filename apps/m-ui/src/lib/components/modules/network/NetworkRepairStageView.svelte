<script lang="ts">
  /**
   * 阶段 5「修复」的修复命令列表子视图。
   *
   * 所有权边界：修复命令的可执行性由 M-Policy 判定，命令本身由 CommandWell 触发执行。
   * 本组件只渲染 BFF 派生的修复动作资格展示态，并把禁用原因码翻译为面向运维者的
   * 中文修复指导；它既不发起命令，也不承载确认流程，CommandWell 宿主边界保留在路由。
   *
   * Join Tickets 小节仍由路由承载，本组件只覆盖修复命令列表。
   */
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'
  import type { NetworkRuntimeTruth } from '$lib/types.ts'

  type RepairAction = NetworkRuntimeTruth['repairActions'][number]

  type Props = {
    /** BFF runtimeTruth 中的修复动作资格列表；为空数组时展示无可用命令占位。 */
    repairActions: readonly RepairAction[]
  }

  let { repairActions }: Props = $props()

  /**
   * 把策略禁用原因码翻译为具体修复指导。
   * 未覆盖的原因码回落到 BFF 提供的原始 message，避免展示层吞掉服务侧解释。
   */
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
</script>

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

<style>
  .mono {
    font-family: var(--font-mono);
  }

  .loading-line {
    color: var(--text-60);
    font-size: var(--text-sm);
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
</style>
