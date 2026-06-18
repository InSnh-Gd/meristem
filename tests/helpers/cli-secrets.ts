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
  const secret = {} as NonNullable<CliClient['secret']>

  if (methods.listSecrets) {
    const listSecrets = methods.listSecrets
    secret.list = async () => {
      const { secrets } = await listSecrets()
      return secrets.map(s => ({
        id: s.id,
        name: s.name,
        scope: s.scope,
        status: s.status,
        createdBy: s.createdBy,
        createdAt: s.createdAt
      }))
    }
  }

  if (methods.getSecret) {
    const getSecret = methods.getSecret
    secret.get = async (id: string) => {
      const { secretRef } = await getSecret(id)
      return {
        ...secretRef,
        updatedAt: secretRef.rotatedAt ?? secretRef.disabledAt ?? secretRef.createdAt
      }
    }
  }

  if (methods.createSecret) {
    const createSecret = methods.createSecret
    secret.create = async (input: { name: string; scope: string; value: string }) => {
      const { secretRef } = await createSecret(
        input as {
          name: string
          scope: 'system' | 'service' | 'node'
          value: string
        }
      )
      return { ...secretRef }
    }
  }

  if (methods.rotateSecret) {
    const rotateSecret = methods.rotateSecret
    secret.rotate = async (secretId: string, input: { value: string; reason: string }) => {
      const result = await rotateSecret(secretId, input)
      return {
        ...result.secretRef,
        version: String(result.version),
        rotatedAt: result.secretRef.rotatedAt ?? result.secretRef.createdAt
      }
    }
  }

  if (methods.disableSecret) {
    const disableSecret = methods.disableSecret
    secret.disable = async (secretId: string, input: { reason: string }) => {
      const { secretRef } = await disableSecret(secretId, input)
      return { ...secretRef, disabledAt: secretRef.disabledAt ?? secretRef.createdAt }
    }
  }

  return { status: statusMock, secret }
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
