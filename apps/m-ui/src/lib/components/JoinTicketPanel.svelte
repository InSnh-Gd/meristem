<script lang="ts">
  import { appState } from '$lib/stores.svelte.ts'
  import type { JoinTicketListResponseData, GenericCommandParams } from '$lib/types.ts'

  let { networkId, ticketsData } = $props<{
    networkId: string
    ticketsData: JoinTicketListResponseData | null
  }>()

  let kind = $state('leaf')
  let name = $state('')
  let capabilities = $state('tunnel')
  let expiresInSeconds = $state(3600)

  let commandId = 'mnet.join-ticket.create.execute'

  async function checkEligibility() {
    if (!networkId || !name) return
    const params = {
      networkId,
      kind,
      name,
      capabilities: capabilities.split(',').map(s => s.trim()),
      expiresInSeconds
    }
    
    appState.commandState = null
    appState.commandParams = params
    try {
      const { fetchCommandEligibility } = await import('$lib/bff')
      appState.commandState = await fetchCommandEligibility(appState.token, commandId, params as GenericCommandParams)
    } catch {
      appState.commandState = null
      appState.commandParams = null
    }
  }

  $effect(() => {
    kind
    name
    capabilities
    expiresInSeconds
    appState.commandState = null
  })
</script>

<div class="join-ticket-stack">
  <div class="form-container">
    <h3>创建 Join Ticket</h3>
    <div class="form-row">
      <div class="form-group">
        <label for="ticket-name">节点名称</label>
        <input id="ticket-name" type="text" bind:value={name} placeholder="输入节点名称..." />
      </div>
      <div class="form-group">
        <label for="ticket-kind">节点类型</label>
        <select id="ticket-kind" bind:value={kind}>
          <option value="leaf">Leaf</option>
          <option value="stem">Stem</option>
        </select>
      </div>
    </div>
    
    <div class="form-row">
      <div class="form-group">
        <label for="ticket-caps">能力集 (逗号分隔)</label>
        <input id="ticket-caps" type="text" bind:value={capabilities} placeholder="tunnel, relay..." />
      </div>
      <div class="form-group">
        <label for="ticket-expires">有效期 (秒)</label>
        <input id="ticket-expires" type="number" bind:value={expiresInSeconds} />
      </div>
    </div>

    <div class="action-row">
      <button class="check-btn" onclick={checkEligibility} disabled={!name}>验证资格</button>
    </div>
  </div>

  <div class="list-container">
    <h3>现有 Ticket</h3>
    {#if !ticketsData}
      <p class="empty-state">正在加载或无权查看...</p>
    {:else if ticketsData.tickets.length === 0}
      <p class="empty-state">暂无 Join Ticket</p>
    {:else}
      <table class="ticket-table">
        <thead>
          <tr>
            <th>Ticket ID</th>
            <th>状态</th>
            <th>过期时间</th>
            <th>Token</th>
          </tr>
        </thead>
        <tbody>
          {#each ticketsData.tickets as ticket}
            <tr>
              <td class="mono">{ticket.ticketId}</td>
              <td class="mono">{ticket.status}</td>
              <td class="mono">{ticket.expiresAt}</td>
              <td class="mono clip">{ticket.ticket}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .join-ticket-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  h3 {
    font-size: var(--text-base);
    font-weight: var(--fw-semibold);
    color: var(--text-100);
    margin: 0 0 var(--space-3) 0;
  }

  .form-container {
    background: var(--surface-float);
    border: 1px solid var(--line-soft);
    padding: var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .form-row {
    display: flex;
    gap: var(--space-3);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1;
  }

  label {
    font-size: var(--text-xs);
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  input, select {
    padding: var(--space-2);
    border: 1px solid var(--line-soft);
    background: var(--surface-root);
    color: var(--text-100);
    font-size: var(--text-sm);
  }

  input:focus, select:focus {
    outline: 1px solid var(--signal-info);
    border-color: var(--line-strong);
  }

  .action-row {
    margin-top: var(--space-1);
  }

  .check-btn {
    padding: var(--space-2) var(--space-4);
    background: var(--surface-root);
    border: 1px solid var(--line-strong);
    color: var(--text-100);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .check-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .check-btn:not(:disabled):hover {
    background: var(--surface-raised);
  }

  .ticket-table {
    width: 100%;
    border-collapse: collapse;
    text-align: left;
    font-size: var(--text-xs);
    border: 1px solid var(--line-soft);
  }

  .ticket-table th, .ticket-table td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--line-soft);
  }

  .ticket-table th {
    background: var(--surface-float);
    color: var(--text-60);
    font-weight: var(--fw-semibold);
  }

  .mono {
    font-family: var(--font-mono);
  }

  .clip {
    max-width: 150px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-state {
    font-size: var(--text-sm);
    color: var(--text-60);
  }
</style>
