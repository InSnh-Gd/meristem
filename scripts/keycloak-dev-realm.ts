/**
 * keycloak-dev-realm.ts — 本地 Keycloak dev realm CLI 入口。
 */
import {
  ensureKeycloakDevRealm,
  mintKeycloakTokenForActor,
  readState,
  runKeycloakProof,
  stopKeycloakDevRealm
} from './keycloak-dev-realm-runtime.ts'
import { keycloakContainerName, type KeycloakTestActor } from './keycloak-dev-realm-model.ts'

export * from './keycloak-dev-realm-model.ts'
export * from './keycloak-dev-realm-runtime.ts'

function actorFromArgv(argv: readonly string[]): KeycloakTestActor {
  const explicit = argv.find(argument => argument.startsWith('--actor='))?.split('=')[1]
  if (explicit === 'operator' || explicit === 'viewer' || explicit === 'admin') return explicit
  return 'operator'
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start'

  if (command === 'stop') {
    await stopKeycloakDevRealm()
    process.stdout.write(
      `${JSON.stringify({ action: 'stop', status: 'success', containerName: keycloakContainerName }, null, 2)}\n`
    )
    return
  }

  if (command === 'proof') {
    process.stdout.write(`${JSON.stringify(await runKeycloakProof(), null, 2)}\n`)
    return
  }

  if (command === 'status') {
    const state = readState()
    process.stdout.write(
      `${JSON.stringify({ action: 'status', running: state !== null, realm: state }, null, 2)}\n`
    )
    return
  }

  if (command === 'mint-check') {
    const realmResult = await ensureKeycloakDevRealm()
    if (!realmResult.ok) {
      process.stdout.write(`${JSON.stringify(realmResult, null, 2)}\n`)
      return
    }

    process.stdout.write(
      `${JSON.stringify(await mintKeycloakTokenForActor(realmResult.realm, actorFromArgv(process.argv)), null, 2)}\n`
    )
    return
  }

  process.stdout.write(`${JSON.stringify(await ensureKeycloakDevRealm(), null, 2)}\n`)
}

if (import.meta.main) {
  await main()
}
