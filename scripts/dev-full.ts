import { resolve } from 'node:path'
import {
  coreServiceCommands,
  prepareInfra,
  prepareWorkspace,
  profileFlagsFromArgv,
  runServiceGroup,
  webUiServiceCommands
} from './local-stack-runtime.ts'

// Point services at the local dev deployment config so loadRuntimeDeploymentConfigOrThrow() finds it
process.env.MERISTEM_V02_DEPLOYMENT_CONFIG ??= resolve(import.meta.dir, '..', 'config', 'dev-deployment.json')

await prepareInfra(profileFlagsFromArgv())
await prepareWorkspace()
await runServiceGroup([...coreServiceCommands, ...webUiServiceCommands])
