import { Elysia, t } from 'elysia'
import {
  OidcIamAuthorizationCallbackV01TypeBoxSchema,
  OidcIamAuthorizationStartV01TypeBoxSchema,
  OidcIamPrincipalApprovalV01TypeBoxSchema,
  OidcIamPrincipalReasonV01TypeBoxSchema,
  OidcIamPrincipalRolesV01TypeBoxSchema
} from '../../../../packages/contracts/src/index.ts'
import type { MUiBffOidcAuthDeps } from '../deps.ts'
import { createBffAuthSupport, toBffAuthResponse } from './bff-auth-support.ts'

const principalParamsSchema = t.Object({ principalId: t.String({ minLength: 1 }) })

async function respond(result: Promise<Parameters<typeof toBffAuthResponse>[0]>): Promise<Response> {
  return toBffAuthResponse(await result)
}

/**
 * OIDC 与 local IAM 路由：TypeBox 在边界校验输入，support 完成 state/nonce/PKCE、
 * session、CSRF 与 local IAM 编排；高风险状态变化由注入的 Core/M-Policy/M-Log 端口决定。
 */
export function createBffAuthRoutes(auth: MUiBffOidcAuthDeps | undefined) {
  const support = createBffAuthSupport(auth)

  return new Elysia()
    .get(
      '/api/v0/auth/oidc/login',
      ({ query }) => respond(support.startLogin(query.returnTo)),
      { query: OidcIamAuthorizationStartV01TypeBoxSchema }
    )
    .get(
      '/api/v0/auth/oidc/callback',
      ({ query }) => respond(support.completeLogin(query)),
      { query: OidcIamAuthorizationCallbackV01TypeBoxSchema }
    )
    .get('/api/v0/auth/session', ({ headers }) => respond(support.session(headers)))
    .post('/api/v0/auth/session/rotate', ({ headers }) => respond(support.rotate(headers)))
    .post('/api/v0/auth/logout', ({ headers }) => respond(support.logout(headers)))
    .post(
      '/api/v0/auth/principals/:principalId/approve',
      ({ headers, params, body }) =>
        respond(support.approve(headers, params.principalId, body.roles)),
      { params: principalParamsSchema, body: OidcIamPrincipalApprovalV01TypeBoxSchema }
    )
    .post(
      '/api/v0/auth/principals/:principalId/reject',
      ({ headers, params, body }) =>
        respond(support.reject(headers, params.principalId, body.reason)),
      { params: principalParamsSchema, body: OidcIamPrincipalReasonV01TypeBoxSchema }
    )
    .put(
      '/api/v0/auth/principals/:principalId/roles',
      ({ headers, params, body }) =>
        respond(support.replaceRoles(headers, params.principalId, body.roles)),
      { params: principalParamsSchema, body: OidcIamPrincipalRolesV01TypeBoxSchema }
    )
    .post(
      '/api/v0/auth/principals/:principalId/disable',
      ({ headers, params, body }) =>
        respond(support.disable(headers, params.principalId, body.reason)),
      { params: principalParamsSchema, body: OidcIamPrincipalReasonV01TypeBoxSchema }
    )
}
