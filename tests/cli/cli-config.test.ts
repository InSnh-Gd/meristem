import { afterAll, beforeAll, describe } from 'bun:test'
import {
  createConfigPayloadFiles,
  removeConfigPayloadFiles,
  type ConfigPayloadFiles
} from '../helpers/cli-config.ts'
import { registerCliConfigBasicTests } from './cli-config-basic.ts'
import { registerCliConfigLifecycleTests } from './cli-config-lifecycle.ts'

// ---------------------------------------------------------------------------
// Config Lifecycle CLI tests
//
// Tests exercise config list/show/draft/validate/publish/rollback through
// mocked nested config methods on CliClient. The mock uses `unknown` cast
// to bridge the gap between test fixtures and the production type.
//
// Sentinel prefix: CFG-CLI
// ---------------------------------------------------------------------------

let payloadFiles: ConfigPayloadFiles

beforeAll(async () => {
  payloadFiles = await createConfigPayloadFiles('cli-config')
})

afterAll(async () => {
  await removeConfigPayloadFiles(payloadFiles)
})

describe('meristem CLI — config', () => {
  registerCliConfigBasicTests(() => payloadFiles)
  registerCliConfigLifecycleTests(() => payloadFiles)
})
