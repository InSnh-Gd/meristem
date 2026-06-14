import {
  coreServiceScripts,
  deployedWebUiServiceScripts,
  prepareInfra,
  prepareWorkspace,
  profileFlagsFromArgv,
  runServiceGroup
} from './local-stack-runtime.ts'

const prepareOnly = Bun.argv.includes('--prepare-only')

async function main(): Promise<void> {
  await prepareInfra(profileFlagsFromArgv())
  await prepareWorkspace()

  if (prepareOnly) {
    console.log('Local deployment prerequisites are ready.')
    return
  }

  const services = [...coreServiceScripts, ...deployedWebUiServiceScripts]

  console.log('Meristem local deployment started:')
  console.log('- Core: http://127.0.0.1:3000')
  console.log('- BFF: http://127.0.0.1:3200')
  console.log(`- Web UI: http://127.0.0.1:${process.env.MERISTEM_UI_PORT ?? '5173'}`)

  await runServiceGroup(services)
}

if (import.meta.main) {
  await main()
}
