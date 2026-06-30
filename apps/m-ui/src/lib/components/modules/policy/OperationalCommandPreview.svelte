<script lang="ts">
  import type { CommandPreviewResult } from '$lib/types.ts'

  const commandDefinitions: Record<
    CommandPreviewResult['commandId'],
    {
      label: string
      requiredPermissions: string[]
      risk: string
      requiresPolicy: boolean
      requiresAudit: boolean
    }
  > = {
    'policy.approval.approve.preview': {
      label: '批准审批请求',
      requiredPermissions: ['policy:approval-approve'],
      risk: 'high',
      requiresPolicy: true,
      requiresAudit: true
    },
    'policy.approval.reject.preview': {
      label: '拒绝审批请求',
      requiredPermissions: ['policy:approval-reject'],
      risk: 'high',
      requiresPolicy: true,
      requiresAudit: true
    },
    'network.profile.enable.preview': {
      label: '启用 Network Profile',
      requiredPermissions: ['network:profile-enable'],
      risk: 'high',
      requiresPolicy: true,
      requiresAudit: true
    },
    'network.profile.disable.preview': {
      label: '停用 Network Profile',
      requiredPermissions: ['network:profile-disable'],
      risk: 'high',
      requiresPolicy: true,
      requiresAudit: true
    }
  }

  type Props = {
    commandId: CommandPreviewResult['commandId']
    disabledReason: string
    resource?: string
    requiredPermissions?: string[]
    label?: string
  }

  let {
    commandId,
    disabledReason,
    resource = 'display-only',
    requiredPermissions,
    label
  }: Props = $props()

  const definition = $derived(commandDefinitions[commandId])
  const visiblePermissions = $derived(requiredPermissions ?? definition.requiredPermissions)
  const visibleLabel = $derived(label ?? definition.label)
</script>

<section class="command-preview workbench-card" aria-label="操作预览">
  <div class="command-header">
    <div class="zone-titles">
      <p class="zone-eyebrow">禁用命令预览</p>
      <h3>{visibleLabel}</h3>
    </div>
    <span class="disabled-chip">不可执行</span>
  </div>

  <p class="reason">原因：{disabledReason}</p>

  <dl class="command-meta">
    <div>
      <dt>commandId</dt>
      <dd>{commandId}</dd>
    </div>
    <div>
      <dt>resource</dt>
      <dd>{resource}</dd>
    </div>
    <div>
      <dt>risk</dt>
      <dd>{definition.risk}</dd>
    </div>
    <div>
      <dt>displayOnly</dt>
      <dd>true</dd>
    </div>
    <div>
      <dt>requiresPolicy</dt>
      <dd>{definition.requiresPolicy ? 'true' : 'false'}</dd>
    </div>
    <div>
      <dt>requiresAudit</dt>
      <dd>{definition.requiresAudit ? 'true' : 'false'}</dd>
    </div>
  </dl>

  <div class="permission-block">
    <p class="permission-title">所需权限</p>
    <ul>
      {#each visiblePermissions as permission}
        <li>{permission}</li>
      {/each}
    </ul>
  </div>
</section>

<style>
  .command-preview {
    gap: var(--space-3);
  }

  .command-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .zone-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .zone-eyebrow,
  .reason,
  .disabled-chip,
  .command-meta dt,
  .command-meta dd,
  .permission-title,
  .permission-block li {
    font-size: var(--text-xs);
  }

  .zone-eyebrow,
  .command-meta dt,
  .permission-title {
    color: var(--text-60);
  }

  h3 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .disabled-chip {
    border: 1px solid var(--signal-block);
    color: var(--signal-block);
    padding: 0 var(--space-2);
    white-space: nowrap;
    border-radius: var(--radius-pill);
  }

  .reason,
  .command-meta dd,
  .permission-block li {
    color: var(--text-100);
    font-family: var(--font-mono);
    line-height: var(--lh-log);
  }

  .command-meta {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
    margin: 0;
  }

  .command-meta div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    padding: var(--space-2);
    border: 1px solid color-mix(in srgb, var(--line-soft) 72%, transparent);
    border-radius: var(--control-radius);
    background: color-mix(in srgb, var(--surface-root) 70%, var(--surface-panel));
  }

  .command-meta dd {
    margin: 0;
    word-break: break-word;
  }

  .permission-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .permission-block ul {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin: 0;
    padding-left: var(--space-4);
  }

  @media (max-width: 760px) {
    .command-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .command-meta {
      grid-template-columns: 1fr;
    }
  }
</style>
