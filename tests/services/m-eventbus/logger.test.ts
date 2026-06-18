import { afterEach, describe, expect, it } from 'bun:test'
import { createLogger } from '../../../packages/telemetry/src/logger.ts'

const originalEnv = { ...process.env }
const originalWrite = process.stdout.write.bind(process.stdout)

afterEach(() => {
  process.env = { ...originalEnv }
  process.stdout.write = originalWrite
})

describe('m-eventbus pino logger pilot', () => {
  it('imports pino and returns a usable logger instance', () => {
    const logger = createLogger('m-eventbus')
    expect(logger).toBeDefined()
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(logger.level).toBe('info')
  })

  it('emits structured output when logging', () => {
    const captured: string[] = []
    process.stdout.write = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }

    const logger = createLogger('m-eventbus')
    logger.info({ url: 'http://127.0.0.1:3102' }, 'm-eventbus listening')

    expect(captured.length).toBeGreaterThan(0)
    const output = captured.join('')
    expect(output).toContain('m-eventbus listening')
    expect(output).toContain('m-eventbus')
  })

  it('respects MERISTEM_LOG_LEVEL env var', () => {
    process.env.MERISTEM_LOG_LEVEL = 'debug'
    const logger = createLogger('m-eventbus')
    expect(logger.level).toBe('debug')
  })

  it('produces JSON lines in production mode', () => {
    process.env.NODE_ENV = 'production'
    const captured: string[] = []
    process.stdout.write = (chunk: string | Uint8Array) => {
      captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }

    const logger = createLogger('m-eventbus')
    logger.info('production smoke')

    expect(captured.length).toBeGreaterThan(0)
    const line = captured.join('').trim()
    const parsed = JSON.parse(line) as Record<string, unknown>
    expect(parsed.msg).toBe('production smoke')
    expect(parsed.service).toBe('m-eventbus')
    expect(parsed.level).toBe(30)
  })
})
