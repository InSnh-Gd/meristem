type SpawnOptions = {
  readonly cwd?: string
  readonly env?: Record<string, string | undefined>
}

type StopOptions = {
  readonly gracefulTimeoutMs?: number
}

export type ManagedProcess = {
  readonly pid: number
  readonly stdout: string
  readonly stderr: string
  readonly exited: Promise<number>
  stop(options?: StopOptions): Promise<number>
}

function collectText(stream: ReadableStream<Uint8Array> | null | undefined, append: (chunk: string) => void): void {
  if (!stream) return

  const decoder = new TextDecoder()

  void (async () => {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value && value.length > 0) append(decoder.decode(value, { stream: true }))
      }
      append(decoder.decode())
    } catch {
      // Stream teardown is expected when the subprocess exits or is stopped.
    } finally {
      reader.releaseLock()
    }
  })()
}

/**
 * Starts a Bun subprocess with piped stdout/stderr so integration tests can poll readiness
 * and inspect diagnostics without introducing Node-specific process management.
 */
export function startBunScript(script: string, options: SpawnOptions = {}): ManagedProcess {
  return startProcess(['bun', '--eval', script], options)
}

/**
 * Starts an arbitrary subprocess and captures its text output incrementally for later assertions.
 */
export function startProcess(command: readonly string[], options: SpawnOptions = {}): ManagedProcess {
  const stdoutChunks: string[] = []
  const stderrChunks: string[] = []
  const subprocess = Bun.spawn([...command], {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    env: {
      ...process.env,
      ...options.env
    },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe'
  })

  collectText(subprocess.stdout, (chunk) => stdoutChunks.push(chunk))
  collectText(subprocess.stderr, (chunk) => stderrChunks.push(chunk))

  let stopRequested = false

  return {
    get pid() {
      return subprocess.pid
    },
    get stdout() {
      return stdoutChunks.join('')
    },
    get stderr() {
      return stderrChunks.join('')
    },
    exited: subprocess.exited,
    async stop(stopOptions: StopOptions = {}): Promise<number> {
      if (!stopRequested) {
        stopRequested = true
        const gracefulTimeoutMs = stopOptions.gracefulTimeoutMs ?? 1_000
        try {
          // Test-managed services in this repo listen for SIGINT to flush logs, close sockets,
          // and stop internal HTTP servers before the process exits.
          subprocess.kill('SIGINT')
        } catch {
          // If the subprocess already exited, Bun can reject the signal request; the exit promise still resolves.
        }

        const exitedGracefully = await Promise.race([
          subprocess.exited.then((code) => ({ done: true as const, code })),
          Bun.sleep(gracefulTimeoutMs).then(() => ({ done: false as const, code: null }))
        ])

        if (!exitedGracefully.done) {
          try {
            subprocess.kill('SIGKILL')
          } catch {
            // The process may have exited between the timeout firing and the force-stop attempt.
          }
        }
      }
      return await subprocess.exited
    }
  }
}

/**
 * Stops a managed subprocess and returns its exit code once Bun reports termination.
 */
export async function stopProcess(process: ManagedProcess): Promise<number> {
  return await process.stop()
}
