<script lang="ts">
  import type { MDeployTopologyData } from '$lib/types.ts'
  import StateSourceBadge from '$lib/components/ui/StateSourceBadge.svelte'

  let { data }: { data: MDeployTopologyData } = $props()
</script>

<section class="workbench-panel" aria-labelledby="deploy-topology-title">
  <div class="panel-header">
    <div>
      <p class="workbench-eyebrow">基础设施拓扑</p>
      <h2 id="deploy-topology-title" class="workbench-section-title">节点、运行时与故障域</h2>
    </div>
    <StateSourceBadge source={data.stateSource.sourceType} />
  </div>

  <dl class="workbench-meta-grid">
    <div><dt>topologyId</dt><dd>{data.topology.topologyId}</dd></div>
    <div><dt>revision</dt><dd>{data.topology.revision}</dd></div>
    <div><dt>networkId</dt><dd>{data.topology.network.networkId}</dd></div>
    <div><dt>cidr</dt><dd>{data.topology.network.cidr}</dd></div>
  </dl>

  <div class="table-wrap">
    <table class="workbench-table">
      <thead>
        <tr><th>节点</th><th>工作负载</th><th>提供者</th><th>故障域</th><th>资源</th></tr>
      </thead>
      <tbody>
        {#if data.topology.nodes.length === 0}
          <tr><td colspan="5" class="workbench-empty">当前拓扑没有节点记录。</td></tr>
        {:else}
          {#each data.topology.nodes as node}
            <tr>
              <td class="mono">{node.nodeId}</td>
              <td>{node.workloadClass}</td>
              <td class="mono">{node.runtimeDriver}</td>
              <td class="mono">{node.failureDomain}</td>
              <td class="mono">{node.resources.vcpu} vCPU / {node.resources.memoryMiB} MiB / {node.resources.diskGiB} GiB</td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</section>

<style>
  .table-wrap { overflow-x: auto; }
  .workbench-empty { padding: var(--space-3); text-align: center; }
</style>
