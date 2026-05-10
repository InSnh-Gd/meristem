type RetryOptions = {
  readonly label: string
  readonly timeoutMs: number
  readonly intervalMs: number
}

function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms)
}

function retryMessage(label: string, timeoutMs: number, cause?: unknown): string {
  if (cause instanceof Error && cause.message) return `${label} timed out after ${timeoutMs}ms: ${cause.message}`
  if (typeof cause === 'string' && cause.length > 0) return `${label} timed out after ${timeoutMs}ms: ${cause}`
  return `${label} timed out after ${timeoutMs}ms`
}

/**
 * Retries a fallible async probe until it resolves or the timeout elapses.
 */
export async function retryUntil<T>(probe: () => Promise<T> | T, options: RetryOptions): Promise<T> {
  const deadline = performance.now() + options.timeoutMs
  let lastError: unknown

  while (performance.now() <= deadline) {
    try {
      return await probe()
    } catch (error) {
      lastError = error
    }

    const remaining = deadline - performance.now()
    if (remaining <= 0) break
    await sleep(Math.min(options.intervalMs, remaining))
  }

  throw new Error(retryMessage(options.label, options.timeoutMs, lastError))
}

/**
 * Waits until a predicate becomes true, preserving the last failure reason in the timeout message.
 */
export async function waitFor(predicate: () => Promise<boolean> | boolean, options: RetryOptions): Promise<void> {
  await retryUntil(async () => {
    if (await predicate()) return true
    throw new Error('condition returned false')
  }, options)
}
