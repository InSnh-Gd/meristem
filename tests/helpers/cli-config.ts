import type { CliClient } from '../../apps/m-cli/src/cli.ts'

export type ConfigRecord = {
  id: string
  configVersion: string
  schemaVersion: string
  configHash: string
  domain: 'core' | 'm-net' | 'm-policy' | 'm-log' | 'm-extension' | 'm-ui'
  targetScope: string[]
  status: 'draft' | 'validated' | 'published' | 'applied' | 'failed' | 'rolled_back'
  createdBy: string
  createdAt: string
  publishedBy?: string
  publishedAt?: string
  rollbackVersion?: string
}

export type ConfigPayloadFiles = {
  testConfig: string
  secretConfig: string
  tokenConfig: string
  plainTest: string
}

type ConfigCliMethods = {
  list?(): Promise<
    Array<{
      id: string
      configVersion: string
      domain: string
      status: string
      createdBy: string
      createdAt: string
    }>
  >
  get?(id: string): Promise<ConfigRecord>
  draft?(input: { domain: string; payload: Record<string, unknown> }): Promise<ConfigRecord>
  validate?(id: string): Promise<ConfigRecord>
  publish?(id: string, input: { reason: string }): Promise<ConfigRecord>
  rollback?(id: string, input: { toVersion: string; reason: string }): Promise<ConfigRecord>
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

/** 为 config CLI 测试构造带嵌套方法的 mock client。 */
export function configClient(configMethods: ConfigCliMethods): CliClient {
  const config = {} as NonNullable<CliClient['config']>

  if (configMethods.list) {
    config.list = configMethods.list
  }

  if (configMethods.get) {
    const get = configMethods.get
    config.get = async (id: string) => {
      const configRecord = await get(id)
      return {
        ...configRecord,
        payload: {},
        updatedAt: configRecord.publishedAt ?? configRecord.createdAt
      }
    }
  }

  if (configMethods.draft) {
    const draft = configMethods.draft
    config.draft = async (input: { domain: string; payload: unknown; targetScope?: string[] }) => {
      const configRecord = await draft(
        input as {
          domain: string
          payload: Record<string, unknown>
        }
      )
      return { ...configRecord }
    }
  }

  if (configMethods.validate) {
    const validate = configMethods.validate
    config.validate = async (id: string) => {
      const configRecord = await validate(id)
      return { ...configRecord }
    }
  }

  if (configMethods.publish) {
    const publish = configMethods.publish
    config.publish = async (id: string, input: { reason: string }) => {
      const configRecord = await publish(id, input)
      return {
        id: configRecord.id,
        configVersion: configRecord.configVersion,
        status: configRecord.status,
        publishedAt: configRecord.publishedAt ?? configRecord.createdAt,
        publishedBy: configRecord.publishedBy ?? configRecord.createdBy
      }
    }
  }

  if (configMethods.rollback) {
    const rollback = configMethods.rollback
    config.rollback = async (id: string, input: { toVersion: string; reason: string }) => {
      const configRecord = await rollback(id, input)
      return { ...configRecord }
    }
  }

  return { status: statusMock, config }
}

/** 构造不带 config 方法的最小 client。 */
export function bareConfigClient(): CliClient {
  return { status: statusMock }
}

/** 为拆分后的 suite 生成独立的临时配置文件。 */
export async function createConfigPayloadFiles(prefix: string): Promise<ConfigPayloadFiles> {
  const salt = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const files = {
    testConfig: `/tmp/${salt}-test-config.json`,
    secretConfig: `/tmp/${salt}-secret-config.json`,
    tokenConfig: `/tmp/${salt}-token-config.json`,
    plainTest: `/tmp/${salt}-test.json`
  }
  await Bun.write(files.testConfig, JSON.stringify({ key: 'value' }))
  await Bun.write(files.secretConfig, JSON.stringify({ password: 's3cret!', purpose: 'test' }))
  await Bun.write(files.tokenConfig, JSON.stringify({ token: 'test-token-123' }))
  await Bun.write(files.plainTest, JSON.stringify({ key: 'value' }))
  return files
}

/** 清理临时配置文件，允许重复删除。 */
export async function removeConfigPayloadFiles(files: ConfigPayloadFiles): Promise<void> {
  for (const filePath of Object.values(files)) {
    await Bun.file(filePath)
      .delete()
      .catch(error => {
        if (error instanceof Error && error.message.includes('ENOENT')) return
        console.warn(
          `cli-config.test: failed to delete ${filePath} - ${error instanceof Error ? error.message : String(error)}`
        )
      })
  }
}
