/**
 * keycloak-mint-token.ts — 为固定测试 actor 签发 Keycloak dev realm token。
 */
import {
  ensureKeycloakDevRealm,
  mintKeycloakTokenForActor,
  type KeycloakDevRealmPrerequisiteMissing,
  type KeycloakMintedToken,
  type KeycloakTestActor
} from './keycloak-dev-realm.ts'

function actorFromArgv(argv: readonly string[]): KeycloakTestActor {
  const explicit = argv.find(argument => argument.startsWith('--actor='))?.split('=')[1]
  if (explicit === 'operator' || explicit === 'viewer' || explicit === 'admin') return explicit
  return 'operator'
}

function wantsJson(argv: readonly string[]): boolean {
  return argv.includes('--json')
}

function isPrerequisiteMissing(
  value: KeycloakMintedToken | KeycloakDevRealmPrerequisiteMissing
): value is KeycloakDevRealmPrerequisiteMissing {
  return 'status' in value
}

/**
 * mint CLI 自动拉起本地 realm，确保测试入口不需要人工先点开 Keycloak UI。
 */
export async function mintKeycloakTestActorToken(
  actor: KeycloakTestActor
): Promise<KeycloakMintedToken | KeycloakDevRealmPrerequisiteMissing> {
  const realmResult = await ensureKeycloakDevRealm()
  if (!realmResult.ok) return realmResult
  return await mintKeycloakTokenForActor(realmResult.realm, actor)
}

async function main(): Promise<void> {
  const actor = actorFromArgv(process.argv)
  const output = await mintKeycloakTestActorToken(actor)

  if (isPrerequisiteMissing(output)) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }

  if (wantsJson(process.argv)) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
    return
  }

  process.stdout.write(`${output.accessToken}\n`)
}

if (import.meta.main) {
  await main()
}
