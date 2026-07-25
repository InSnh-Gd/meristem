<script lang="ts">
  import { onMount } from 'svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import MDeployTopologyPanel from '$lib/components/modules/deploy/MDeployTopologyPanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import { fetchMDeployTopology, formatBffError } from '$lib/bff.ts'
  import { appState } from '$lib/stores.svelte.ts'
  import type { MDeployTopologyData } from '$lib/types.ts'

  let topology = $state<MDeployTopologyData | null>(null)
  let error = $state<string | null>(null)
  onMount(async () => {
    if (!appState.token) return
    try { topology = await fetchMDeployTopology(appState.token) }
    catch (cause: unknown) { error = formatBffError(cause, '基础设施拓扑加载失败') }
  })
</script>

<section class="route-page"><RouteHeader routeName="M-Deploy 基础设施拓扑" stateSources={['authoritative']} />{#if error}<InlineOperationalAlert message={error} severity="block" />{:else if topology}<MDeployTopologyPanel data={topology} />{/if}</section>

<style>.route-page { display: flex; flex-direction: column; gap: var(--space-4); }</style>
