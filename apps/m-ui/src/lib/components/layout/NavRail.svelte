<script lang="ts">
  import Tooltip from '$lib/components/ui/Tooltip.svelte'
  type NavItem = {
    id: string
    label: string
    ariaLabel?: string
    enabled: boolean
    path?: string
    disabledReason?: string
  }

  let { items, selected } = $props<{
    items: NavItem[]
    selected: string
  }>()

  // Inline SVG icon family drawn for the M-UI operations console.
  // All icons share a 24x24 viewBox, currentColor stroke, rounded caps,
  // and filled accents so they remain readable at small screenshot scale.
  const ICON_SVGS: Record<string, string> = {
    'icon-control':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="4" x2="5" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="19" y1="4" x2="19" y2="20"/><rect x="2" y="8" width="6" height="5" rx="1.5" fill="currentColor" stroke="none"/><rect x="9" y="13" width="6" height="5" rx="1.5" fill="currentColor" stroke="none"/><rect x="16" y="6" width="6" height="5" rx="1.5" fill="currentColor" stroke="none"/></svg>',
    'icon-node':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="3" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="3" fill="currentColor" stroke="none"/><circle cx="19" cy="18" r="3" fill="currentColor" stroke="none"/><path d="M12 8v7M10 16 7 16M14 16h3"/></svg>',
    'icon-task':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="m8 12 2.5 2.5L16 9"/><path d="M7 17h10"/></svg>',
    'icon-policy':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l8.5 4v6c0 5.5-3.5 8.5-8.5 10.5-5-2-8.5-5-8.5-10.5v-6l8.5-4z" fill="currentColor" fill-opacity="0.18"/><path d="m9 12 2.5 2.5L16 10"/></svg>',
    'icon-audit':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2.5H5A2.5 2.5 0 0 0 2.5 5v14A2.5 2.5 0 0 0 5 21.5h14a2.5 2.5 0 0 0 2.5-2.5V8l-7.5-5.5z" fill="currentColor" fill-opacity="0.12"/><path d="M14 2.5V8h6.5"/><path d="M7 11h10"/><path d="M7 15h7"/></svg>',
    'icon-event':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M15.5 7.5a6 6 0 0 1 0 9M8.5 7.5a6 6 0 0 0 0 9M19 4a9.5 9.5 0 0 1 0 16M5 4a9.5 9.5 0 0 0 0 16"/></svg>',
    'icon-network':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity="0.08"/><path d="M12 3v18"/><path d="M3 12h18"/><path d="M5.5 6c2.5 3 2.5 9 0 12"/><path d="M18.5 6c-2.5 3-2.5 9 0 12"/></svg>',
    'icon-service':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2" fill="currentColor" fill-opacity="0.22"/><rect x="13.5" y="3.5" width="7" height="7" rx="2" fill="currentColor" fill-opacity="0.22"/><rect x="3.5" y="13.5" width="7" height="7" rx="2" fill="currentColor" fill-opacity="0.22"/><rect x="13.5" y="13.5" width="7" height="7" rx="2" fill="currentColor" fill-opacity="0.22"/></svg>',
    'icon-default':
      '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 22 7v10l-10 5-10-5V7l10-5z" fill="currentColor" fill-opacity="0.1"/></svg>'
  }

  const BRAND_SVG =
    '<svg class="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20"/><path d="m12 6 5-3"/><path d="m12 10-5-3"/><path d="m12 14 5-3"/><path d="m12 18-5-3"/><circle cx="17" cy="3" r="2" fill="currentColor" stroke="none"/><circle cx="7" cy="7" r="2" fill="currentColor" stroke="none"/><circle cx="17" cy="11" r="2" fill="currentColor" stroke="none"/><circle cx="7" cy="15" r="2" fill="currentColor" stroke="none"/></svg>'

  function iconClassFor(id: string): string {
    if (id.includes('control-room')) return 'icon-control'
    if (id.includes('node')) return 'icon-node'
    if (id.includes('task')) return 'icon-task'
    if (id.includes('policy')) return 'icon-policy'
    if (id.includes('audit')) return 'icon-audit'
    if (id.includes('event') || id.includes('eventbus')) return 'icon-event'
    if (id.includes('net')) return 'icon-network'
    if (id.includes('service')) return 'icon-service'
    return 'icon-default'
  }

  function iconSvgFor(id: string): string {
    return ICON_SVGS[iconClassFor(id)] ?? ICON_SVGS['icon-default']
  }

  function englishLabel(label: string): string {
    const map: Record<string, string> = {
      '控制室': 'Control Room',
      '节点': 'Nodes',
      '时间线': 'Timeline',
      '审计': 'Audit',
      '策略决策': 'Decisions',
      '策略审批': 'Approvals',
      '网络配置': 'Profiles',
    '功能域服务': 'Capability domains',
      '网络': 'Networks',
      '数据面状态': 'DataPlane',
      '配置迁移': 'Migration',
      '紧急熔断': 'Break-Glass'
    }
    for (const [cn, en] of Object.entries(map)) {
      if (label.includes(cn)) return en
    }
    return label
  }
</script>

<div class="nav-rail" data-testid="m-ui-compact-nav-rail">
  <div class="rail-brand">
      <span class="rail-logo" aria-hidden="true">{@html BRAND_SVG}</span>
    <div class="rail-titles">
      <span class="rail-title">Meristem</span>
      <span class="rail-subtitle">WebUI</span>
    </div>
  </div>

  <div class="rail-section">
    {#each items as item}
      {#if item.enabled && item.path}
        <a
          class="nav-item"
          class:active={item.id === selected}
          href={item.path}
          aria-label={item.ariaLabel ?? item.label}
          data-sveltekit-preload-data="off"
        >
          <span class="nav-icon" aria-hidden="true">{@html iconSvgFor(item.id)}</span>
          <span class="nav-label">{item.label}</span>
          <span class="nav-en">{englishLabel(item.label)}</span>
        </a>
      {:else}
        <Tooltip content={item.disabledReason ?? '功能尚未实现'}>
          <button
            class="nav-item disabled"
            aria-disabled="true"
            aria-label={item.ariaLabel ?? item.label}
            aria-describedby={`nav-disabled-reason-${item.id}`}
          >
            <span class="nav-icon" aria-hidden="true">{@html iconSvgFor(item.id)}</span>
            <span class="nav-label">{item.label}</span>
            <span class="nav-en">{englishLabel(item.label)}</span>
            <span id={`nav-disabled-reason-${item.id}`} class="nav-disabled-reason"
              >{item.disabledReason ?? '未实现'}</span
            >
          </button>
        </Tooltip>
      {/if}
    {/each}
  </div>
</div>

<style>
  .nav-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    height: 100%;
    padding: var(--space-3) var(--space-2);
    background: transparent;
  }

  .rail-brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-1) var(--space-3);
    border-bottom: 1px solid color-mix(in srgb, var(--line-soft) 70%, transparent);
    margin-bottom: var(--space-2);
  }

  .rail-logo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid color-mix(in srgb, var(--accent-purple) 20%, transparent);
    border-radius: 9px;
    background: color-mix(in srgb, var(--accent-purple-soft) 70%, transparent);
    color: var(--accent-purple);
  }

  .rail-titles {
    display: flex;
    flex-direction: column;
    line-height: var(--lh-tight);
  }

  .rail-title {
    color: var(--text-100);
    font-size: 17px;
    font-weight: var(--fw-semibold);
  }

  .rail-subtitle {
    color: var(--text-60);
    font-size: 12px;
    font-family: var(--font-mono);
  }

  .rail-section {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .nav-item {
    position: relative;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto;
    column-gap: var(--space-2);
    align-items: center;
    width: 100%;
    min-height: 42px;
    padding: 8px 10px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-60);
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition:
      border-color var(--duration-fast) var(--easing-ui),
      background var(--duration-fast) var(--easing-ui),
      color var(--duration-fast) var(--easing-ui);
  }

  .nav-icon {
    grid-row: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: var(--radius-xs);
    background: transparent;
    color: var(--text-60);
  }

  .nav-label {
    color: inherit;
    font-size: var(--text-sm);
    font-weight: var(--fw-medium);
    line-height: var(--lh-tight);
  }

  .nav-en {
    display: none;
  }

  .nav-item:hover:not(.disabled) {
    border-color: color-mix(in srgb, var(--line-soft) 72%, transparent);
    background: color-mix(in srgb, var(--surface-panel) 56%, transparent);
    color: var(--text-100);
  }

  .nav-item:hover:not(.disabled) .nav-icon {
    color: var(--text-100);
  }

  .nav-item.active {
    border-color: color-mix(in srgb, var(--accent-purple) 34%, transparent);
    background: color-mix(in srgb, var(--accent-purple) 10%, transparent);
    color: var(--text-100);
  }

  .nav-item.active .nav-icon {
    color: var(--accent-purple);
  }

  .nav-item.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: var(--space-1);
    bottom: var(--space-1);
    width: 3px;
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    background: var(--accent-purple);
  }

  .nav-item.disabled {
    color: var(--text-40);
    border-color: transparent;
    cursor: not-allowed;
  }

  .nav-disabled-reason {
    display: none;
    color: var(--text-40);
    font-size: 10px;
    line-height: var(--lh-tight);
  }

  @media (max-width: 760px) {
    .nav-rail {
      flex-direction: row;
      align-items: center;
      overflow-x: auto;
      padding: var(--space-2);
    }

    .rail-brand {
      flex-direction: column;
      align-items: flex-start;
      border-bottom: none;
      border-right: 1px solid var(--line-soft);
      margin-bottom: 0;
      margin-right: var(--space-2);
      padding: var(--space-1) var(--space-2) var(--space-1) var(--space-1);
    }

    .rail-titles {
      display: none;
    }

    .rail-section {
      flex-direction: row;
      gap: var(--space-1);
    }

    .nav-item {
      width: auto;
      min-width: 72px;
      max-width: 120px;
      min-height: 52px;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
    }

    .nav-en {
      display: none;
    }

    .nav-disabled-reason {
      display: block;
    }
  }
</style>
