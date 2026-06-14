import * as Schema from 'effect/Schema'
import { mintLocalToken } from '../../../packages/auth/src/index.ts'
import type { ActorId } from '../../../packages/contracts/src/literals.ts'
import { internalTokenHeaderName } from '../../../packages/internal-http/src/index.ts'
import { createMNetApp } from '../../../services/m-net/src/app.ts'
import type { ProfileStore } from '../../../services/m-net/src/profile-store.ts'
import type { MNetApp } from '../../../services/m-net/src/public-types.ts'
import type { SuspendedOperationStore } from '../../../services/m-net/src/suspended-operations.ts'

export const jwtSecret = 'test-jwt-secret'
export const internalToken = 'internal-test-token'

export function internalHeaders(): Record<string, string> {
  return { [internalTokenHeaderName]: internalToken }
}

export async function mintTestToken(actor: ActorId): Promise<string> {
  return mintLocalToken({ actor, secret: jwtSecret })
}

export function bearerHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

export const ErrorResponseSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.optional(Schema.String)
  })
})

export async function decodeJson<TSchema extends Schema.Schema.AnyNoContext>(
  response: Response,
  schema: TSchema
): Promise<Schema.Schema.Type<TSchema>> {
  return Schema.decodeUnknownSync(schema)(await response.json())
}

export const inMemoryApprovalClient = {
  async create(_input: {
    policyDecisionId: string
    originService: string
    operationId: string
    requestedBy: string
    requiredAction: string
    quorumRequired: number
    expiresAt: string
  }): Promise<
    | { ok: true; value: { approvalId: string } }
    | { ok: false; error: { code: string; message: string } }
  > {
    return { ok: true, value: { approvalId: crypto.randomUUID() } }
  }
}

export function createTestApp(
  profileStore: ProfileStore,
  suspendedOps: SuspendedOperationStore,
  policyAuthorizeOverrides?: {
    authorize(
      _actor: string,
      _action: string,
      _resource: string
    ): Promise<{
      result: 'allow' | 'deny' | 'require_manual_review' | 'require_multi_approval'
      id: string
      reasons: string[]
    }>
  }
): MNetApp {
  return createMNetApp({
    async readiness() {
      return { ready: true }
    },
    async createNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listNetworks() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async joinNetwork() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async listMembers() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    async executeNoop() {
      return { ok: false, error: { code: 'test.not_implemented', message: 'not implemented' } }
    },
    profileStore,
    suspendedOps,
    approvals: inMemoryApprovalClient,
    policyAuthorize: policyAuthorizeOverrides ?? {
      async authorize(_actor, action, _resource) {
        if (action === 'network:profile-read') {
          return { result: 'allow' as const, id: crypto.randomUUID(), reasons: [] }
        }
        return { result: 'require_manual_review' as const, id: crypto.randomUUID(), reasons: [] }
      }
    }
  })
}
