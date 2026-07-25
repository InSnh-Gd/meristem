<script lang="ts">
  import { onMount } from 'svelte'
  import RouteHeader from '$lib/components/layout/RouteHeader.svelte'
  import MDeployHistoryPanel from '$lib/components/modules/deploy/MDeployHistoryPanel.svelte'
  import InlineOperationalAlert from '$lib/components/ui/InlineOperationalAlert.svelte'
  import { fetchMDeployHistory, formatBffError } from '$lib/bff.ts'
  import { appState } from '$lib/stores.svelte.ts'
  import type { MDeployHistoryData } from '$lib/types.ts'

  let history = $state<MDeployHistoryData | null>(null)
  let error = $state<string | null>(null)
  onMount(async () => {
    if (!appState.token) return
    try { history = await fetchMDeployHistory(appState.token) }
    catch (cause: unknown) { error = formatBffError(cause, '部署证据历史加载失败') }
  })
</script>

<section class="route-page"><RouteHeader routeName="M-Deploy 部署历史" stateSources={['audit']} />{#if error}<InlineOperationalAlert message={error} severity="block" />{:else if history}<MDeployHistoryPanel data={history} />{/if}</section>

<style>.route-page { display: flex; flex-direction: column; gap: var(--space-4); }</style>
