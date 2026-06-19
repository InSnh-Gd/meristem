import { afterEach } from 'vitest'
import { appState } from '../../../src/lib/stores.svelte.ts'

export function resetAppState() {
  appState.token = ''
  appState.loading = false
  appState.error = null
  appState.overview = null
  appState.selectedNodeId = null
  appState.commandState = null
  appState.commandParams = null
  appState.taskResult = null
  appState.commandConfirming = false
  appState.policySummary = null
  appState.routes = null
  appState.nodes = null
  appState.timeline = null
  appState.audit = null
  appState.policyDecisions = null
  appState.services = null
  appState.approvalQueue = null
  appState.approvalQueueLoading = false
  appState.approvalQueueError = null
  appState.selectedApproval = null
  appState.selectedApprovalLoading = false
  appState.selectedApprovalError = null
  appState.networkProfiles = null
  appState.networkProfilesLoading = false
  appState.networkProfilesError = null
  appState.selectedProfile = null
  appState.selectedProfileLoading = false
  appState.selectedProfileError = null
  appState.networks = null
  appState.networksLoading = false
  appState.networksError = null
  appState.selectedNetwork = null
  appState.selectedNetworkLoading = false
  appState.selectedNetworkError = null
  appState.joinTickets = null
  appState.joinTicketsLoading = false
  appState.dataplaneStatus = null
  appState.globalDefaults = null
  appState.globalDefaultsLoading = false
}

export function installAppStateReset() {
  afterEach(() => {
    resetAppState()
  })
}
