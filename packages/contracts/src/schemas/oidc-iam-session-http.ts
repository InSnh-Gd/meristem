import { Type } from '@sinclair/typebox'
import { actorIds } from '../literals.ts'
import { OidcIamPrincipalV01TypeBoxSchema } from './oidc-iam-session.ts'

const RoleTypeBoxSchema = Type.Union(actorIds.map(role => Type.Literal(role)))

/** OIDC login entry只接受同源相对返回路径，BFF 会在运行时进一步拒绝开放重定向。 */
export const OidcIamAuthorizationStartV01TypeBoxSchema = Type.Object(
  {
    returnTo: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
)

/** 授权回调只接收一次性 code 与 state，nonce 和 PKCE verifier 保留在服务端。 */
export const OidcIamAuthorizationCallbackV01TypeBoxSchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

/** security-admin 批准 pending principal 时必须显式指定本地角色。 */
export const OidcIamPrincipalApprovalV01TypeBoxSchema = Type.Object(
  {
    roles: Type.Array(RoleTypeBoxSchema, { minItems: 1 })
  },
  { additionalProperties: false }
)

/** 拒绝和禁用均要求可审计的人类原因。 */
export const OidcIamPrincipalReasonV01TypeBoxSchema = Type.Object(
  {
    reason: Type.String({ minLength: 1, maxLength: 1024 })
  },
  { additionalProperties: false }
)

/** 角色替换允许空集合，以支持明确的角色撤销。 */
export const OidcIamPrincipalRolesV01TypeBoxSchema = Type.Object(
  {
    roles: Type.Array(RoleTypeBoxSchema)
  },
  { additionalProperties: false }
)

/** 浏览器只接收可显示身份、角色快照和内存态 CSRF token，不接收 OIDC token。 */
export const OidcIamBrowserSessionContextV01TypeBoxSchema = Type.Object(
  {
    authenticated: Type.Literal(true),
    principal: OidcIamPrincipalV01TypeBoxSchema,
    csrfToken: Type.String({ minLength: 1 }),
    expiresAt: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)
