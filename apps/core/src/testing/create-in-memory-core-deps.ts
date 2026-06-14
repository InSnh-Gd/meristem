import type { CoreDeps } from '../types.ts'
import {
  createAuthPort,
  createEventPort,
  createLogPort,
  createPolicyPort
} from './auth-policy-log.ts'
import { createConfigPort } from './config.ts'
import { createIdentityPort } from './identity.ts'
import {
  createAgentTaskPort,
  createMNetPort,
  createProjectionPort,
  createServiceLifecyclePort
} from './network-runtime.ts'
import { createSecretsPort } from './secrets.ts'
import type { InMemoryOptions } from './shared.ts'
import { createInMemoryCoreTestingContext } from './state.ts'
import { createStoragePort, createTestingControls } from './storage.ts'

/**
 * createInMemoryCoreDeps 把 Core 依赖拆成多个测试支持模块，
 * 同时维持原有单入口，避免测试在重构后丢失稳定的依赖注入方式。
 */
export function createInMemoryCoreDeps(options: InMemoryOptions = {}): CoreDeps {
  const { state, helpers } = createInMemoryCoreTestingContext(options)

  return {
    startedAt: Date.now(),
    version: '0.1.0-test',
    joinIngressPublicUrl: 'https://localhost:8443',
    auth: createAuthPort(state, helpers),
    policy: createPolicyPort(state, helpers),
    log: createLogPort(state, helpers),
    events: createEventPort(),
    mNet: createMNetPort(state, helpers),
    agentTasks: createAgentTaskPort(state),
    services: createServiceLifecyclePort(state),
    projection: createProjectionPort(),
    identity: createIdentityPort(state, helpers),
    secrets: createSecretsPort(state, helpers),
    config: createConfigPort(state, helpers),
    storage: createStoragePort(state, helpers),
    __testing: createTestingControls(state)
  } as CoreDeps
}
