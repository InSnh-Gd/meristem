<script lang="ts">
  import { onMount } from 'svelte'
  import { fetchServiceDetail, formatBffError } from '$lib/bff'
  import { appState } from '$lib/stores.svelte.ts'
  import KeyValueInspector from '$lib/components/ui/KeyValueInspector.svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import ServiceRegistryTable from '$lib/components/modules/control-room/ServiceRegistryTable.svelte'
  import type { ServiceInspectorData } from '$lib/types'

  const stateSources = ['authoritative']
  let selectedServiceId = $state<string | null>(null)
  let selectedServiceDetail = $state<ServiceInspectorData | null>(null)
  let selectedServiceDetailLoading = $state(false)
  let selectedServiceDetailError = $state<string | null>(null)

  const serviceList = $derived(appState.services?.services ?? [])
  const selectedService = $derived.by(() => {
    if (!selectedServiceId) return serviceList[0] ?? null
    return serviceList.find((service) => service.id === selectedServiceId) ?? null
  })

  async function loadSelectedServiceDetail(serviceId: string) {
    if (!appState.token) return
    selectedServiceDetailLoading = true
    selectedServiceDetailError = null
    try {
      selectedServiceDetail = await fetchServiceDetail(appState.token, serviceId)
    } catch (error: unknown) {
      selectedServiceDetail = null
      selectedServiceDetailError = formatBffError(error, '服务详情加载失败')
    } finally {
      selectedServiceDetailLoading = false
    }
  }

  onMount(() => {
    void appState.fetchServices()
  })

  $effect(() => {
    const serviceId = selectedService?.id
    if (!serviceId || !appState.token) {
      selectedServiceDetail = null
      selectedServiceDetailError = null
      selectedServiceDetailLoading = false
      return
    }
    void loadSelectedServiceDetail(serviceId)
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
      {#if selectedServiceDetailLoading}
        <p class="inspector-status">正在加载服务详情…</p>
      {:else if selectedServiceDetailError}
        <p class="inspector-status error">{selectedServiceDetailError}</p>
      {:else if selectedServiceDetail}
        <section class="inspector-section" aria-labelledby="service-detail-title">
          <div class="panel-header compact">
            <h2 id="service-detail-title">服务详情</h2>
            <span class="service-runtime">
              {selectedServiceDetail.service.runtime?.mode === 'degraded' ? '降级' : '正常'}
            </span>
          </div>

          <dl class="summary-grid">
            <div>
              <dt>ID</dt>
              <dd class="mono">{selectedServiceDetail.service.id}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>{selectedServiceDetail.service.version}</dd>
            </div>
            <div>
              <dt>域</dt>
              <dd>{selectedServiceDetail.service.domain}</dd>
            </div>
            <div>
              <dt>类型</dt>
              <dd>{selectedServiceDetail.service.kind}</dd>
            </div>
          </dl>
        </section>

        {#if selectedServiceDetail.eventBusMetrics}
          <section class="inspector-section" aria-labelledby="eventbus-metrics-title">
            <div class="panel-header compact">
              <h2 id="eventbus-metrics-title">EventBus 发布健康</h2>
              <span class="state-source-badge">read-model</span>
            </div>

            <div class="metrics-grid">
              <div>
                <span>成功</span>
                <strong>{selectedServiceDetail.eventBusMetrics.totals.success}</strong>
              </div>
              <div>
                <span>拒绝</span>
                <strong>{selectedServiceDetail.eventBusMetrics.totals.rejected}</strong>
              </div>
              <div>
                <span>失败</span>
                <strong>{selectedServiceDetail.eventBusMetrics.totals.failed}</strong>
              </div>
              <div>
                <span>重试</span>
                <strong>{selectedServiceDetail.eventBusMetrics.totals.retryAttempts}</strong>
              </div>
            </div>

            {#if selectedServiceDetail.eventBusMetrics.lastFailed}
              <p class="event-summary error">
                最近失败：
                <span class="mono">{selectedServiceDetail.eventBusMetrics.lastFailed.failedSubject}</span>
                · {selectedServiceDetail.eventBusMetrics.lastFailed.errorMessage}
              </p>
            {/if}

            {#if selectedServiceDetail.eventBusMetrics.lastRejected}
              <p class="event-summary warn">
                最近拒绝：
                <span class="mono">{selectedServiceDetail.eventBusMetrics.lastRejected.failedSubject}</span>
                · {selectedServiceDetail.eventBusMetrics.lastRejected.reason}
              </p>
            {/if}
          </section>
        {/if}

        <section class="inspector-section" aria-labelledby="service-raw-title">
          <h2 id="service-raw-title">原始详情</h2>
          <KeyValueInspector item={selectedServiceDetail} />
        </section>
      {:else}
        <p class="inspector-status">暂无服务详情</p>
      {/if}
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

  .inspector-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .panel-header.compact {
    align-items: center;
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

  .inspector-section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .summary-grid,
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .summary-grid div,
  .metrics-grid div {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    border: 1px solid var(--line-soft);
    background: var(--surface-panel);
  }

  dt,
  .metrics-grid span {
    color: var(--text-60);
    font-size: var(--text-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  dd,
  .metrics-grid strong {
    margin: 0;
    color: var(--text-100);
    font-size: var(--text-sm);
    font-weight: var(--fw-semibold);
  }

  .service-runtime,
  .state-source-badge {
    color: var(--text-200);
    font-size: var(--text-xs);
    font-weight: var(--fw-medium);
  }

  .event-summary {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-200);
  }

  .event-summary.error {
    color: var(--signal-block);
  }

  .event-summary.warn {
    color: var(--signal-warn);
  }

  .inspector-status {
    margin: 0;
    color: var(--text-200);
    font-size: var(--text-sm);
  }

  .inspector-status.error {
    color: var(--signal-block);
  }

  @media (max-width: 960px) {
    .services-layout {
      grid-template-columns: 1fr;
    }

    .summary-grid,
    .metrics-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
