import type { ManagedProcess } from './process.ts'

export type CliE2eContext = {
  devAll: ManagedProcess | null
  bffProcess: ManagedProcess | null
  operatorToken: string
  viewerToken: string
  securityAdminToken: string
  leafName: string
  networkName: string
  cliConfigId: string
  cliConfigVersion: string
}

export function createCliE2eContext(): CliE2eContext {
  return {
    devAll: null,
    bffProcess: null,
    operatorToken: '',
    viewerToken: '',
    securityAdminToken: '',
    leafName: '',
    networkName: '',
    cliConfigId: '',
    cliConfigVersion: ''
  }
}

export const CLI_SECRET_SENTINEL = 'super_secret_sentinel_12345'
