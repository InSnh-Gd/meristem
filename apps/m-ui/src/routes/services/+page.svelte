<script lang="ts">
  import { onMount } from 'svelte'
  import { appState } from '$lib/stores.svelte.ts'
  import KeyValueInspector from '$lib/components/KeyValueInspector.svelte'
  import RouteHeader from '$lib/components/RouteHeader.svelte'
  import ServiceRegistryTable from '$lib/components/ServiceRegistryTable.svelte'

  const stateSources = ['authoritative']
  let selectedServiceId = $state<string | null>(null)

  const serviceList = $derived(appState.services?.services ?? [])
  const selectedService = $derived.by(() => {
    if (!selectedServiceId) return serviceList[0] ?? null
    return serviceList.find((service) => service.id === selectedServiceId) ?? null
  })

  onMount(() => {
    void appState.fetchServices()
  })
</script>

<svelte:head>
  <title>服务 | Meristem</title>
</svelte:head>

<section class="services-page">
  <RouteHeader routeName="服务" {stateSources} />

  <div class="services-layout">
    <section class="panel" aria-labelledby="service-registry-title">
      <div class="panel-header">
        <h2 id="service-registry-title">服务注册表</h2>
        <span class="service-count">{serviceList.length} 个服务</span>
      </div>

      <ServiceRegistryTable services={serviceList} />

      {#if serviceList.length > 0}
        <div class="service-selector" aria-label="服务选择器">
          {#each serviceList as service}
            <button
              type="button"
              class:selected={selectedService?.id === service.id}
              onclick={() => selectedServiceId = service.id}
            >
              <span class="mono">{service.id}</span>
              <span>{service.runtime?.mode === 'degraded' ? '降级' : '正常'}</span>
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <aside class="inspector-panel" aria-label="服务检查器">
      <KeyValueInspector item={selectedService} />
    </aside>
  </div>
</section>

<style>
  .services-page {
    display: flex;
    flex-direction: column;
    gap: var(--panel-gap);
  }

  .services-layout {
    display: grid;
    grid-template-columns: 1fr var(--inspector-width);
    gap: var(--panel-gap);
  }

  .panel,
  .inspector-panel {
    min-width: 0;
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    padding: var(--space-4);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
  }

  .service-count {
    color: var(--text-100);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
  }

  .service-selector {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .service-selector button {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    color: var(--text-100);
    cursor: pointer;
    font-family: var(--font-body);
    font-size: var(--text-sm);
    padding: var(--space-2) var(--space-3);
  }

  .service-selector button:hover,
  .service-selector button:focus-visible,
  .service-selector button.selected {
    border-color: var(--line-strong);
    outline: 1px solid var(--signal-info);
    outline-offset: 0;
  }

  .mono {
    font-family: var(--font-mono);
  }

  @media (max-width: 960px) {
    .services-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
