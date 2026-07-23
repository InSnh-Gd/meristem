/**
 * OIDC state、nonce 和 PKCE verifier 只存放在 BFF 进程内的一次性登录事务中，
 * 回调消费后立即删除，避免浏览器持有可复用认证材料。
 */
export type OidcLoginTransaction = {
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
  readonly codeChallenge: string
  readonly returnTo: string
  readonly expiresAt: string
}

export type OidcLoginTransactionStore = {
  create(input: { readonly returnTo: string }): Promise<OidcLoginTransaction>
  consume(state: string): OidcLoginTransaction | null
}

export type OidcLoginTransactionStoreOptions = {
  readonly now?: () => Date
  readonly ttlMs?: number
  readonly randomBytes?: (length: number) => Uint8Array
}

const defaultLoginTransactionTtlMs = 5 * 60 * 1_000

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function randomBase64Url(randomBytes: (length: number) => Uint8Array): string {
  return bytesToBase64Url(randomBytes(32))
}

async function createCodeChallenge(codeVerifier: string): Promise<string> {
  const value = new TextEncoder().encode(codeVerifier)
  const digest = await crypto.subtle.digest('SHA-256', value)
  return bytesToBase64Url(new Uint8Array(digest))
}

/** 创建 state/nonce/PKCE 一次性事务；回调时必须由 consume 校验并销毁。 */
export function createOidcLoginTransactionStore(
  options: OidcLoginTransactionStoreOptions = {}
): OidcLoginTransactionStore {
  const now = options.now ?? (() => new Date())
  const ttlMs = options.ttlMs ?? defaultLoginTransactionTtlMs
  const randomBytes = options.randomBytes ?? (length => crypto.getRandomValues(new Uint8Array(length)))
  const transactions = new Map<string, OidcLoginTransaction>()

  return {
    async create(input) {
      const createdAt = now()
      const state = randomBase64Url(randomBytes)
      const nonce = randomBase64Url(randomBytes)
      const codeVerifier = randomBase64Url(randomBytes)
      const transaction: OidcLoginTransaction = {
        state,
        nonce,
        codeVerifier,
        codeChallenge: await createCodeChallenge(codeVerifier),
        returnTo: input.returnTo,
        expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString()
      }
      transactions.set(state, transaction)
      return transaction
    },
    consume(state) {
      const transaction = transactions.get(state) ?? null
      if (transaction === null) return null
      transactions.delete(state)
      return new Date(transaction.expiresAt).getTime() > now().getTime() ? transaction : null
    }
  }
}
