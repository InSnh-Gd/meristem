import {
  coreServiceCommands,
  prepareInfra,
  prepareWorkspace,
  profileFlagsFromArgv,
  runServiceGroup,
  webUiServiceCommands
} from './local-stack-runtime.ts'

await prepareInfra(profileFlagsFromArgv())
await prepareWorkspace()
await runServiceGroup([...coreServiceCommands, ...webUiServiceCommands])
