import { describe, expect, it } from 'bun:test'
import {
  currentTraceId,
  injectTraceHeaders,
  initTelemetry,
  recordGauge,
  shutdownTelemetry
} from '../../../packages/telemetry/src/index.ts'

describe('packages/telemetry current trace', () => {
  it('currentTraceId returns undefined when no active span', () => {
    expect(currentTraceId()).toBeUndefined()
  })
})

describe('packages/telemetry initialized API', () => {
  const serviceName = 'test-service'

  it('initTelemetry returns a tracer object', () => {
    process.env.MERISTEM_OTEL_EXPORTER = 'none'
    const tracer = initTelemetry(serviceName)
    expect(tracer).toBeDefined()
    expect(typeof tracer.startActiveSpan).toBe('function')
  })

  it('injectTraceHeaders adds traceparent header to empty headers object', async () => {
    const tracer = initTelemetry(serviceName)
    await new Promise<void>((resolve, reject) => {
      tracer.startActiveSpan('test-span', span => {
        try {
          const headers = injectTraceHeaders({})
          expect(typeof headers.traceparent).toBe('string')
          expect(headers.traceparent.length).toBeGreaterThan(0)
          span.end()
          resolve()
        } catch (error) {
          span.end()
          reject(error)
        }
      })
    })
  })

  it('injectTraceHeaders preserves existing headers while adding trace context', async () => {
    const tracer = initTelemetry(serviceName)
    await new Promise<void>((resolve, reject) => {
      tracer.startActiveSpan('test-span', span => {
        try {
          const headers = injectTraceHeaders({ authorization: 'Bearer test' })
          expect(headers.authorization).toBe('Bearer test')
          expect(typeof headers.traceparent).toBe('string')
          expect(headers.traceparent.length).toBeGreaterThan(0)
          span.end()
          resolve()
        } catch (error) {
          span.end()
          reject(error)
        }
      })
    })
  })

  it('recordGauge does not throw when called', () => {
    expect(() => recordGauge('test.gauge', 1, { service: serviceName })).not.toThrow()
  })

  it('shutdownTelemetry does not throw', async () => {
    await shutdownTelemetry()
    expect(true).toBe(true)
  })
})
