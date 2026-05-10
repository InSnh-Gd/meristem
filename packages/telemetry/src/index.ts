import { context, propagation, SpanStatusCode, trace, type Attributes } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  CompositePropagator,
  ExportResultCode,
  W3CBaggagePropagator,
  W3CTraceContextPropagator
} from '@opentelemetry/core'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter
} from '@opentelemetry/sdk-trace-base'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

let initialized = false
let provider: BasicTracerProvider | null = null

/**
 * 控制台 exporter 需要输出微秒时间戳，方便与日志、事件和数据库中的 ISO 时间互相对照。
 */
function toMicroseconds([seconds, nanoseconds]: [number, number]): number {
  return (seconds * 1_000_000) + Math.round(nanoseconds / 1_000)
}

class StderrConsoleSpanExporter implements SpanExporter {
  /**
   * span 统一写入 stderr，避免污染 CLI stdout 的 JSON 输出和脚本管道消费。
   */
  export(spans: ReadableSpan[], resultCallback: (result: { code: ExportResultCode; error?: Error }) => void): void {
    try {
      for (const span of spans) {
        process.stderr.write(`${JSON.stringify({
          resource: { attributes: span.resource.attributes },
          instrumentationScope: span.instrumentationScope,
          traceId: span.spanContext().traceId,
          parentSpanContext: span.parentSpanContext,
          traceState: span.spanContext().traceState?.serialize(),
          name: span.name,
          id: span.spanContext().spanId,
          kind: span.kind,
          timestamp: toMicroseconds(span.startTime),
          duration: toMicroseconds(span.duration),
          attributes: span.attributes,
          status: span.status,
          events: span.events,
          links: span.links
        }, null, 2)}\n`)
      }
      resultCallback({ code: ExportResultCode.SUCCESS })
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error('span export failed')
      })
    }
  }

  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

/**
 * Telemetry 初始化全局只做一次，避免多个服务入口重复覆盖全局 provider 与 propagator。
 */
function ensureGlobalTelemetry(serviceName: string): void {
  if (initialized) return
  const exporterMode = process.env.MERISTEM_OTEL_EXPORTER ?? 'console'

  provider = new BasicTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName
    }),
    spanProcessors: exporterMode === 'none'
      ? []
      : [new SimpleSpanProcessor(new StderrConsoleSpanExporter())]
  })

  trace.setGlobalTracerProvider(provider)
  context.setGlobalContextManager(new AsyncLocalStorageContextManager())
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()]
    })
  )
  initialized = true
}

/**
 * 每个进程在入口处调用 initTelemetry，拿到本服务 tracer 后再开展业务调用。
 */
export function initTelemetry(serviceName: string) {
  ensureGlobalTelemetry(serviceName)
  return trace.getTracer(serviceName, '0.1.0')
}

/**
 * 测试和进程退出都必须显式 shutdown，避免 span processor 残留在全局状态里。
 */
export async function shutdownTelemetry(): Promise<void> {
  if (!provider) return
  await provider.shutdown()
  provider = null
  initialized = false
}

/**
 * currentTraceId 只读取当前活动 span，不自行创建 trace，避免边界层误以为已经建链。
 */
export function currentTraceId(): string | undefined {
  return trace.getActiveSpan()?.spanContext().traceId
}

/**
 * HTTP 出站统一通过这里注入 trace header，保证内部 Eden/HTTP 调用和外部入口语义一致。
 */
export function injectTraceHeaders(headers: Record<string, string>): Record<string, string> {
  const carrier = { ...headers }
  propagation.inject(context.active(), carrier)
  return carrier
}

/**
 * withExtractedSpan 负责从上游 header 恢复上下文，再在当前服务里围出新的活动 span。
 */
export async function withExtractedSpan<T>(
  serviceName: string,
  spanName: string,
  headers: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
  attributes?: Attributes
): Promise<T> {
  const tracer = initTelemetry(serviceName)
  const carrier = Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  const extracted = propagation.extract(context.active(), carrier)

  return context.with(extracted, () =>
    tracer.startActiveSpan(spanName, async (span) => {
      if (attributes) span.setAttributes(attributes)
      try {
        const result = await fn()
        span.setStatus({ code: SpanStatusCode.OK })
        return result
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error)
          span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
        } else {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'unknown error' })
        }
        throw error
      } finally {
        span.end()
      }
    })
  )
}

/**
 * 没有上游传播头时，直接在当前上下文里创建一个新的活动 span。
 */
export async function withActiveSpan<T>(
  serviceName: string,
  spanName: string,
  fn: () => Promise<T> | T,
  attributes?: Attributes
): Promise<T> {
  return withExtractedSpan(serviceName, spanName, {}, fn, attributes)
}
