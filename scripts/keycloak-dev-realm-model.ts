import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  DeploymentConfigV02FromSchema,
  OidcAuthProviderConfigFromSchema
} from '../packages/contracts/src/index.ts'

export const rootDir = import.meta.dir.replace(/\/scripts$/, '')
export const workspaceDir = join(rootDir, '.local', 'keycloak-dev-realm')
export const stateFile = join(workspaceDir, 'state.json')
export const realmImportFile = join(workspaceDir, 'meristem-realm.json')

export const keycloakRealmName = 'meristem'
export const keycloakContainerName = 'meristem-keycloak-dev-realm'
export const keycloakImage = process.env.MERISTEM_KEYCLOAK_IMAGE ?? 'quay.io/keycloak/keycloak:26.2.5'
export const keycloakClientId = 'meristem-core'
export const keycloakClientSecret = 'meristem-dev-realm-client-secret'
export const keycloakClientSecretEnvVar = 'MERISTEM_FIXTURE_KEYCLOAK_CLIENT_SECRET'
export const keycloakAdminUsername = 'meristem-admin'
export const keycloakAdminPassword = 'meristem-admin-password'

export type KeycloakTestActor = 'operator' | 'viewer' | 'admin'
export type KeycloakRuntime = 'docker' | 'podman'

export type KeycloakActorDefinition = {
  readonly clientRoles: readonly string[]
  readonly displayName: string
  readonly email: string
  readonly firstName: string
  readonly lastName: string
  readonly password: string
  readonly realmRoles: readonly string[]
  readonly subject: KeycloakTestActor
  readonly username: string
}

export type KeycloakRealmState = {
  readonly actorCredentials: Record<KeycloakTestActor, KeycloakActorDefinition>
  readonly adminPassword: string
  readonly adminUsername: string
  readonly baseUrl: string
  readonly clientId: string
  readonly clientSecret: string
  readonly containerName: string
  readonly discoveryUrl: string
  readonly hostPort: number
  readonly image: string
  readonly issuer: string
  readonly jwksUrl: string
  readonly realmImportFile: string
  readonly realmName: string
  readonly runtime: KeycloakRuntime
  readonly stateFile: string
  readonly tokenUrl: string
}

export type KeycloakDevRealmPrerequisiteMissing = {
  readonly ok: false
  readonly message: string
  readonly status: 'prerequisite-missing'
  readonly step:
    | 'container_runtime'
    | 'container_runtime_access'
    | 'image_pull'
    | 'port_allocation'
}

export type KeycloakDevRealmReady = {
  readonly ok: true
  readonly realm: KeycloakRealmState
  readonly startedNow: boolean
}

export type KeycloakDevRealmResult = KeycloakDevRealmReady | KeycloakDevRealmPrerequisiteMissing

export type KeycloakMintedToken = {
  readonly accessToken: string
  readonly actor: KeycloakTestActor
  readonly claims: import('jose').JWTPayload
  readonly expiresIn: number
  readonly tokenType: string
}

export const actorDefinitions = {
  operator: {
    subject: 'operator',
    username: 'operator-login',
    firstName: 'Operator',
    lastName: 'Login',
    password: 'meristem-operator-password',
    displayName: 'Meristem Operator',
    email: 'operator@example.com',
    realmRoles: ['operator', 'network:read', 'task:submit'],
    clientRoles: ['audit:read']
  },
  viewer: {
    subject: 'viewer',
    username: 'viewer-login',
    firstName: 'Viewer',
    lastName: 'Login',
    password: 'meristem-viewer-password',
    displayName: 'Meristem Viewer',
    email: 'viewer@example.com',
    realmRoles: ['viewer'],
    clientRoles: []
  },
  admin: {
    subject: 'admin',
    username: 'admin-login',
    firstName: 'Admin',
    lastName: 'Login',
    password: 'meristem-admin-password',
    displayName: 'Meristem Admin',
    email: 'admin@example.com',
    realmRoles: ['admin', 'network:read', 'task:submit'],
    clientRoles: ['audit:read']
  }
} satisfies Record<KeycloakTestActor, KeycloakActorDefinition>

/**
 * 用可预测端口和固定 OIDC surface 生成 realm 状态，避免测试脚本各自拼接 URL。
 */
export function buildRealmState(runtime: KeycloakRuntime, hostPort: number): KeycloakRealmState {
  const baseUrl = `http://127.0.0.1:${hostPort}`
  const issuer = `${baseUrl}/realms/${keycloakRealmName}`

  return {
    runtime,
    hostPort,
    baseUrl,
    issuer,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    jwksUrl: `${issuer}/protocol/openid-connect/certs`,
    tokenUrl: `${issuer}/protocol/openid-connect/token`,
    realmName: keycloakRealmName,
    containerName: keycloakContainerName,
    image: keycloakImage,
    clientId: keycloakClientId,
    clientSecret: keycloakClientSecret,
    adminUsername: keycloakAdminUsername,
    adminPassword: keycloakAdminPassword,
    actorCredentials: actorDefinitions,
    stateFile,
    realmImportFile
  }
}

function roleRepresentation(name: string) {
  return { name, description: `Meristem test role ${name}` }
}

function realmImportPayload(realm: KeycloakRealmState) {
  return {
    realm: realm.realmName,
    enabled: true,
    accessTokenLifespan: 300,
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    resetPasswordAllowed: false,
    roles: {
      realm: ['viewer', 'operator', 'admin', 'network:read', 'task:submit'].map(roleRepresentation),
      client: {
        [realm.clientId]: ['audit:read'].map(roleRepresentation)
      }
    },
    clients: [
      {
        clientId: realm.clientId,
        name: 'Meristem Core Test Client',
        enabled: true,
        protocol: 'openid-connect',
        publicClient: false,
        secret: realm.clientSecret,
        directAccessGrantsEnabled: true,
        standardFlowEnabled: false,
        serviceAccountsEnabled: false,
        fullScopeAllowed: true,
        defaultClientScopes: ['profile', 'email', 'roles'],
        protocolMappers: [
          {
            name: 'meristem-subject-mapper',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-attribute-mapper',
            consentRequired: false,
            config: {
              'userinfo.token.claim': 'true',
              'id.token.claim': 'true',
              'access.token.claim': 'true',
              'claim.name': 'sub',
              'jsonType.label': 'String',
              'user.attribute': 'meristem_actor_id'
            }
          },
          {
            name: 'meristem-display-name-mapper',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-attribute-mapper',
            consentRequired: false,
            config: {
              'userinfo.token.claim': 'true',
              'id.token.claim': 'true',
              'access.token.claim': 'true',
              'claim.name': 'preferred_username',
              'jsonType.label': 'String',
              'user.attribute': 'meristem_display_name'
            }
          },
          {
            name: 'meristem-email-mapper',
            protocol: 'openid-connect',
            protocolMapper: 'oidc-usermodel-property-mapper',
            consentRequired: false,
            config: {
              'userinfo.token.claim': 'true',
              'id.token.claim': 'true',
              'access.token.claim': 'true',
              'claim.name': 'email',
              'jsonType.label': 'String',
              'user.attribute': 'email'
            }
          }
        ]
      }
    ],
    users: Object.values(realm.actorCredentials).map(actor => ({
      username: actor.username,
      firstName: actor.firstName,
      lastName: actor.lastName,
      enabled: true,
      emailVerified: true,
      email: actor.email,
      requiredActions: [],
      credentials: [
        {
          type: 'password',
          value: actor.password,
          temporary: false
        }
      ],
      attributes: {
        meristem_actor_id: [actor.subject],
        meristem_display_name: [actor.displayName]
      },
      realmRoles: [...actor.realmRoles],
      clientRoles: {
        [realm.clientId]: [...actor.clientRoles]
      }
    }))
  }
}

/**
 * Realm import 文件是容器启动唯一配置面，避免测试依赖管理 UI 手工点击。
 */
export function writeRealmImport(realm: KeycloakRealmState): void {
  writeFileSync(realm.realmImportFile, `${JSON.stringify(realmImportPayload(realm), null, 2)}\n`)
}

export function buildKeycloakAuthConfig(realm: KeycloakRealmState): OidcAuthProviderConfigFromSchema {
  return {
    provider: 'oidc',
    issuer: realm.issuer,
    discoveryUrl: realm.discoveryUrl,
    audiences: [realm.clientId],
    allowedAlgorithms: ['RS256'],
    claims: {
      subjectClaim: 'sub',
      groupsClaim: 'realm_access.roles',
      displayNameClaim: 'preferred_username',
      emailClaim: 'email'
    },
    jwksCache: {
      refreshIntervalMs: 10_000,
      ttlMs: 60_000
    },
    clockToleranceSeconds: 0
  }
}

/**
 * 部署配置 fixture 仍然是通用 OIDC 契约，只把 issuer/discovery/client secret 绑定到本地 realm。
 */
export function buildKeycloakDeploymentConfig(realm: KeycloakRealmState): DeploymentConfigV02FromSchema {
  return {
    track: 'oci',
    serviceUrls: {
      core: 'http://127.0.0.1:3000',
      mnet: 'http://127.0.0.1:3104',
      policy: 'http://127.0.0.1:3101',
      log: 'http://127.0.0.1:3102',
      eventbus: 'http://127.0.0.1:3103',
      task: 'http://127.0.0.1:3105',
      extension: 'http://127.0.0.1:3106',
      uiBff: 'http://127.0.0.1:3200',
      nodeAgent: 'http://127.0.0.1:3307'
    },
    internalAuth: {
      headerName: 'x-meristem-internal-token',
      tokenEnvVar: 'MERISTEM_INTERNAL_TOKEN'
    },
    oidc: buildKeycloakAuthConfig(realm),
    secretProvider: {
      providerName: 'runtime',
      backend: 'local-dev-env',
      namedProvider: {
        name: 'runtime',
        config: {
          backend: 'local-dev-env',
          envMappings: {
            'keycloak/client-secret': keycloakClientSecretEnvVar
          }
        }
      }
    },
    secretBindings: [
      {
        envVar: 'MERISTEM_OIDC_CLIENT_SECRET',
        ref: {
          provider: 'runtime',
          keyPath: 'keycloak/client-secret'
        }
      }
    ],
    netbird: {
      signalEndpoint: 'https://signal.control-plane.example.com:443',
      relayEndpoint: 'turns://relay.control-plane.example.com:443',
      stunEndpoint: 'stun:relay.control-plane.example.com:3478'
    },
    nodeAgentCapabilities: {
      netAdmin: true,
      wireguardModulePath: '/sys/module/wireguard',
      wgBinaryPath: '/run/current-system/sw/bin/wg',
      ipBinaryPath: '/run/current-system/sw/bin/ip'
    },
    readiness: {
      postgres: { kind: 'postgres-select-1', target: 'postgres' },
      core: { kind: 'http-get', target: 'core', endpoint: 'http://127.0.0.1:3000/api/v0/ready' },
      mnet: { kind: 'http-get', target: 'm-net', endpoint: 'http://127.0.0.1:3104/ready' },
      policy: { kind: 'http-get', target: 'm-policy', endpoint: 'http://127.0.0.1:3101/ready' },
      log: { kind: 'http-get', target: 'm-log', endpoint: 'http://127.0.0.1:3102/ready' },
      eventbus: { kind: 'http-get', target: 'm-eventbus', endpoint: 'http://127.0.0.1:3103/ready' },
      task: { kind: 'http-get', target: 'm-task', endpoint: 'http://127.0.0.1:3105/health' },
      extension: { kind: 'http-get', target: 'm-extension', endpoint: 'http://127.0.0.1:3106/ready' },
      uiBff: { kind: 'http-get', target: 'm-ui-bff', endpoint: 'http://127.0.0.1:3200/ready' },
      nodeAgent: {
        kind: 'command',
        target: 'node-agent',
        command: ['systemctl', 'is-active', 'meristem-node-agent']
      }
    }
  }
}
