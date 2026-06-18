<script lang="ts">
  import type { NetworkDetailResponseData } from '$lib/types.ts'
  import StateSourceBadge from './StateSourceBadge.svelte'

  let { networkData } = $props<{
    networkData: NetworkDetailResponseData
  }>()

  let members = $derived(networkData.members)
</script>

<div class="network-detail-stack">
  <div class="detail-header">
    <div>
      <h2 class="mono">{networkData.network.name}</h2>
      <p class="meta-line">ID: {networkData.network.id}</p>
      <p class="meta-line">Profile: {networkData.network.profileVersion}</p>
    </div>
    <StateSourceBadge source={networkData.network.stateSource.sourceType} />
  </div>

  <div class="table-container">
    <table class="member-table">
      <thead>
        <tr>
          <th>节点 ID</th>
          <th>类型</th>
          <th>模式</th>
          <th>状态</th>
          <th>加入时间</th>
          <th>来源</th>
        </tr>
      </thead>
      <tbody>
        {#if members.length === 0}
          <tr>
            <td colspan="6" class="empty-cell">暂无成员</td>
          </tr>
        {:else}
          {#each members as member}
            <tr>
              <td class="mono">{member.nodeId}</td>
              <td class="mono">{member.nodeKind}</td>
              <td class="mono">{member.membershipMode}</td>
              <td class="mono">{member.status}</td>
              <td class="mono">{member.joinedAt}</td>
              <td><StateSourceBadge source={member.stateSource.sourceType} /></td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .network-detail-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .detail-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  h2 {
    color: var(--text-100);
    font-size: var(--text-lg);
    font-weight: var(--fw-semibold);
    line-height: var(--lh-tight);
    margin: 0;
  }

  .meta-line {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-60);
    margin-top: var(--space-1);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .table-container {
    overflow-x: auto;
    border: 1px solid var(--line-soft);
  }

  .member-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: var(--text-xs);
  }

  .member-table th,
  .member-table td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--line-soft);
  }

  .member-table th {
    font-weight: var(--fw-semibold);
    color: var(--text-60);
    background: var(--surface-float);
  }

  .member-table tbody tr:last-child td {
    border-bottom: none;
  }

  .empty-cell {
    text-align: center;
    padding: var(--space-4);
    color: var(--text-60);
  }
</style>
