<script lang="ts">
  type Severity = 'warn' | 'risk' | 'block'

  const severityColor: Record<Severity, string> = {
    warn: 'var(--signal-warn)',
    risk: 'var(--signal-risk)',
    block: 'var(--signal-block)'
  }

  type Props = {
    message: string
    severity: Severity
  }

  let { message, severity }: Props = $props()

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
    border-radius: var(--operational-card-radius);
    background: color-mix(in srgb, var(--alert-color) 8%, var(--surface-root));
    color: var(--text-100);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  .alert-icon {
    color: var(--alert-color);
    line-height: var(--lh-tight);
    font-weight: var(--fw-semibold);
  }
</style>
