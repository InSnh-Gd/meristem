import type { FullLog } from '../../../packages/contracts/src/index.ts'

export type LogLevel = FullLog['level']

export const allowedLogLevels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

export type LogRuntimeState = {
  logLevel: LogLevel
  lastReloadedAt?: string
}

export function readLogLevelFromEnv(): LogLevel {
  const level = process.env.MERISTEM_LOG_LEVEL ?? 'info'
  if (allowedLogLevels.includes(level as LogLevel)) return level as LogLevel
  throw new Error(`invalid MERISTEM_LOG_LEVEL: ${level}`)
}

export function createLogRuntimeState(): LogRuntimeState {
  return {
    logLevel: readLogLevelFromEnv()
  }
}
