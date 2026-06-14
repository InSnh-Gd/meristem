import {
  coreServiceScripts,
  prepareInfra,
  prepareWorkspace,
  profileFlagsFromArgv,
  runServiceGroup,
  webUiServiceScripts
} from './local-stack-runtime.ts'

await prepareInfra(profileFlagsFromArgv())
await prepareWorkspace()
await runServiceGroup([...coreServiceScripts, ...webUiServiceScripts])
