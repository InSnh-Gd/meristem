import {
  coreServiceScripts,
  prepareInfra,
  prepareWorkspace,
  profileFlagsFromArgv,
  runServiceGroup
} from './local-stack-runtime.ts'

await prepareInfra(profileFlagsFromArgv())
await prepareWorkspace()
await runServiceGroup(coreServiceScripts)
