import { serviceUrl } from '../../../packages/internal-http/src/index.ts'
import type { CliClient } from './commands/types.ts'
import { createApprovalsClient } from './clients/approvals-client.ts'
import { createConfigClient } from './clients/config-client.ts'
import { createCoreDomainClient } from './clients/core-client.ts'
import type { CliConfig } from './clients/shared.ts'
import { createExtensionClient } from './clients/extension-client.ts'
import { createIdentityClient } from './clients/identity-client.ts'
import { createMnetClient } from './clients/mnet-client.ts'
import { createNodeNetworkClient } from './clients/node-network-client.ts'
import { createProjectionClient } from './clients/projection-client.ts'
import { createCliRuntime } from './clients/runtime.ts'
import { createSecretClient } from './clients/secret-client.ts'
import { createTaskClient } from './clients/task-client.ts'

export type { CliConfig } from './clients/shared.ts'

/**
 * CLI 官方客户端只负责按域组装子客户端，具体 HTTP / Eden 调用分散到专用模块中。
 */
export function createCoreClient(config: CliConfig): CliClient {
  const runtime = createCliRuntime(config)
  return {
    ...createCoreDomainClient(runtime),
    ...createNodeNetworkClient(runtime),
    ...createMnetClient(runtime),
    ...createTaskClient(runtime),
    ...createProjectionClient(runtime),
    ...createApprovalsClient(runtime),
    ...createExtensionClient(runtime),
    identity: createIdentityClient(runtime),
    secret: createSecretClient(runtime),
    config: createConfigClient(runtime)
  }
}

/**
 * CLI 运行配置保持最小化，只依赖服务地址和 Bearer Token。
 */
export function configFromEnv(): CliConfig {
  return {
    coreUrl: process.env.MERISTEM_CORE_URL ?? 'http://localhost:3000',
    taskUrl: process.env.MERISTEM_TASK_URL ?? serviceUrl('m-task'),
    policyUrl: process.env.MERISTEM_POLICY_URL ?? serviceUrl('m-policy'),
    mnetUrl: process.env.MERISTEM_MNET_URL ?? serviceUrl('m-net'),
    extensionUrl: process.env.MERISTEM_EXTENSION_URL ?? serviceUrl('m-extension'),
    token: process.env.MERISTEM_TOKEN
  }
}
