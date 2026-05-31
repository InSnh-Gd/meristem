<script lang="ts">
  type Severity = 'warn' | 'risk' | 'block'

  const severityColor: Record<Severity, string> = {
    warn: 'var(--signal-warn)',
    risk: 'var(--signal-risk)',
    block: 'var(--signal-block)'
  }

  let { message, severity } = $props<{
    message: string
    severity: Severity
  }>()

  const color = $derived(severityColor[severity])
</script>

<div class="inline-operational-alert" style:--alert-color={color} role="alert">
  <span class="alert-icon" aria-hidden="true">⚠</span>
  <span>{message}</span>
</div>

<style>
  .inline-operational-alert {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    border: 1px solid var(--alert-color);
    border-radius: var(--space-1);
    background: var(--surface-sunken);
    color: var(--text-100);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  .alert-icon {
    color: var(--alert-color);
    line-height: var(--lh-tight);
  }
</style>
