import type { CliClient } from '../../apps/m-cli/src/cli.ts'

export type SecretRef = {
  id: string
  version: 'secret-ref@0.1.0'
  name: string
  scope: 'system' | 'service' | 'node'
  owner: 'core'
  status: 'active' | 'rotated' | 'disabled'
  createdBy: string
  createdAt: string
  rotatedAt?: string
  disabledAt?: string
  metadata: Record<string, string>
}

export type SecretCliMethods = {
  listSecrets?(): Promise<{ secrets: SecretRef[] }>
  getSecret?(id: string): Promise<{ secretRef: SecretRef }>
  createSecret?(input: {
    name: string
    scope: 'system' | 'service' | 'node'
    value: string
  }): Promise<{ secretRef: SecretRef }>
  rotateSecret?(
    secretId: string,
    input: { value: string; reason: string }
  ): Promise<{ secretRef: SecretRef; version: number }>
  disableSecret?(secretId: string, input: { reason: string }): Promise<{ secretRef: SecretRef }>
}

export async function statusMock() {
  return {
    core: { id: 'meristem-core', version: '0.1.0', mode: 'normal' as const },
    dependencies: {
      postgres: 'ready' as const,
      nats: 'ready' as const,
      'm-policy': 'ready' as const,
      'm-log': 'ready' as const,
      'm-eventbus': 'ready' as const,
      'm-net': 'ready' as const
    },
    counts: { services: 1, nodes: 2, tasks: 3 }
  }
}

/** 为 secret CLI 测试构造带嵌套方法的 mock client。 */
export function secretClient(methods: SecretCliMethods): CliClient {
  const secret = {
    list: methods.listSecrets,
    get: methods.getSecret,
    create: methods.createSecret,
    rotate: methods.rotateSecret,
    disable: methods.disableSecret
  }
  return { status: statusMock, secret } as unknown as CliClient
}

/** 构造不带 secret 方法的最小 client。 */
export function bareSecretClient(): CliClient {
  return { status: statusMock }
}

export const activeSecret: SecretRef = {
  id: 'sr-cli-001',
  version: 'secret-ref@0.1.0',
  name: 'api-key-staging',
  scope: 'service',
  owner: 'core',
  status: 'active',
  createdBy: 'security-admin',
  createdAt: '2026-06-01T10:00:00.000Z',
  metadata: { env: 'staging' }
}

export const rotatedSecret: SecretRef = {
  id: 'sr-cli-002',
  version: 'secret-ref@0.1.0',
  name: 'db-password',
  scope: 'system',
  owner: 'core',
  status: 'rotated',
  createdBy: 'security-admin',
  createdAt: '2026-05-01T10:00:00.000Z',
  rotatedAt: '2026-06-01T10:00:00.000Z',
  metadata: {}
}

export const disabledSecret: SecretRef = {
  id: 'sr-cli-003',
  version: 'secret-ref@0.1.0',
  name: 'old-token',
  scope: 'node',
  owner: 'core',
  status: 'disabled',
  createdBy: 'security-admin',
  createdAt: '2026-04-01T10:00:00.000Z',
  disabledAt: '2026-06-01T10:00:00.000Z',
  metadata: { reason: 'decommissioned' }
}

export const SECRET_SENTINEL = 'MERISTEM_TEST_SECRET_DO_NOT_LOG'
