export type MNetServiceError = {
  code: string
  message: string
}

export type MNetServiceResult<T> = { ok: true; value: T } | { ok: false; error: MNetServiceError }
