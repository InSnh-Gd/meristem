import pino, { type DestinationStream, type Logger } from 'pino'

/**
 * Operational logging factory for Meristem services.
 *
 * This is strictly operational logging (startup, degraded warnings, DLQ
 * failures). It is NOT a replacement for M-Log's authoritative Timeline / Full
 * / Audit fact emission — those travel through the write-service and OpenSearch
 * projection pipeline, never through pino.
 *
 * Level is configurable via `MERISTEM_LOG_LEVEL` (default 'info'). In
 * production (`NODE_ENV=production`) logs are emitted as JSON lines; in any
 * other environment a minimal pretty-printer is used so local `bun run dev:*`
 * output stays readable. The pretty-printer is self-contained — it does not
 * pull in `pino-pretty`, which keeps the dependency surface of the pilot
 * limited to the already-installed `pino@10.3.1`.
 */

const DEFAULT_LOG_LEVEL = 'info'

function resolveLogLevel(): string {
  const fromEnv = process.env.MERISTEM_LOG_LEVEL
  if (fromEnv && fromEnv.length > 0) return fromEnv
  return DEFAULT_LOG_LEVEL
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

const LEVEL_LABELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal'
}

/**
 * Minimal pretty-print destination. Parses each JSON line emitted by pino and
 * writes a single human-readable line to stdout. Keeps the pilot free of the
 * `pino-pretty` dependency while still giving developers scannable output.
 */
class PrettyStream implements DestinationStream {
  write(raw: string): void {
    const line = raw.endsWith('\n') ? raw.slice(0, -1) : raw
    if (line.length === 0) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(line) as Record<string, unknown>
    } catch {
      // Not JSON (shouldn't happen with pino, but stay defensive) — pass through.
      process.stdout.write(`${line}\n`)
      return
    }

    const level = parsed.level
    const label = typeof level === 'number' ? (LEVEL_LABELS[level] ?? 'info') : 'info'
    const time = parsed.time
    const timeLabel =
      typeof time === 'number' ? new Date(time).toISOString() : new Date().toISOString()
    const service = typeof parsed.service === 'string' ? parsed.service : 'unknown'
    const msg = typeof parsed.msg === 'string' ? parsed.msg : ''

    const { service: _service, level: _level, time: _time, msg: _msg, ...rest } = parsed
    const hasContext = Object.keys(rest).length > 0
    const context = hasContext ? ` ${JSON.stringify(rest)}` : ''

    process.stdout.write(`${timeLabel} ${label.toUpperCase()} [${service}] ${msg}${context}\n`)
  }
}

function buildDestination(): DestinationStream {
  return isProduction() ? process.stdout : new PrettyStream()
}

/**
 * Create a pino logger for a Meristem service. The logger is named with the
 * service name so every line carries its origin, and the level is read from
 * `MERISTEM_LOG_LEVEL` at construction time.
 *
 * @param serviceName - short service identifier, e.g. 'm-eventbus'
 */
export function createLogger(serviceName: string): Logger {
  return pino(
    {
      name: serviceName,
      level: resolveLogLevel(),
      base: { service: serviceName }
    },
    buildDestination()
  )
}

export type { Logger } from 'pino'
