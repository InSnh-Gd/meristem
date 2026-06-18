type RetryOptions = {
  readonly label: string
  readonly timeoutMs: number
  readonly intervalMs: number
}

type WaitForOutputOptions = RetryOptions & {
  readonly text: string
}

type WaitForHttpOkOptions = RetryOptions & {
  readonly url: string
}

type WaitForReadyJsonOptions = RetryOptions & {
  readonly url: string
}

function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms)
}

function retryMessage(label: string, timeoutMs: number, cause?: unknown): string {
  if (cause instanceof Error && cause.message)
    return `${label} timed out after ${timeoutMs}ms: ${cause.message}`
  if (typeof cause === 'string' && cause.length > 0)
    return `${label} timed out after ${timeoutMs}ms: ${cause}`
  return `${label} timed out after ${timeoutMs}ms`
}

/**
 * Retries a fallible async probe until it resolves or the timeout elapses.
 */
export async function retryUntil<T>(
  probe: () => Promise<T> | T,
  options: RetryOptions
): Promise<T> {
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
export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  options: RetryOptions
): Promise<void> {
  await retryUntil(async () => {
    if (await predicate()) return true
    throw new Error('condition returned false')
  }, options)
}

/**
 * 等待测试托管进程输出特定文本，统一覆盖率模式下的输出轮询行为。
 */
export async function waitForOutput(
  readOutput: () => string,
  options: WaitForOutputOptions
): Promise<void> {
  await waitFor(() => readOutput().includes(options.text), options)
}

/**
 * 等待 HTTP 探针返回 2xx，避免把服务就绪语义绑定到 stdout 文本。
 */
export async function waitForHttpOk(options: WaitForHttpOkOptions): Promise<void> {
  await waitFor(async () => {
    try {
      const response = await fetch(options.url)
      return response.ok
    } catch {
      return false
    }
  }, options)
}

/**
 * 等待 ready 路由返回 `{ ready: true }`，用于跨服务依赖齐备后的启动判定。
 */
export async function waitForReadyJson(options: WaitForReadyJsonOptions): Promise<void> {
  await waitFor(async () => {
    try {
      const response = await fetch(options.url)
      if (!response.ok) return false
      const body = await response.json().catch(() => null)
      return Boolean(body && typeof body === 'object' && 'ready' in body && body.ready === true)
    } catch {
      return false
    }
  }, options)
}
