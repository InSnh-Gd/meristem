import { createCoreApp } from './app.ts'
import { createProductionDeps } from './adapters.ts'
import { createEventEnvelope } from '../../../packages/events/src/index.ts'
import { currentTraceId, initTelemetry, shutdownTelemetry, withActiveSpan } from '../../../packages/telemetry/src/index.ts'

// Core 入口只负责装配依赖、发布启动事件和处理优雅退出，业务规则留在 app 与 adapters。
const deps = await createProductionDeps()
const port = Number(process.env.PORT ?? '3000')
const hostname = process.env.MERISTEM_CORE_HOST ?? '127.0.0.1'
initTelemetry('meristem-core')

createCoreApp(deps).listen({ hostname, port })
console.log(`meristem-core listening on http://${hostname}:${port}`)

// 启动事件是控制面生命周期的第一条事实记录，用来串联后续 ready、降级和审计链路。
await withActiveSpan('meristem-core', 'meristem-core.startup', async () => {
  const traceId = currentTraceId()
  await deps.events.publish(
    'core.lifecycle.started.v0',
    createEventEnvelope({
      type: 'core.lifecycle.started',
      source: 'meristem-core',
      payload: {
        nodeId: 'meristem-core',
        startedAt: new Date().toISOString(),
        version: deps.version
      },
      ...(traceId ? { traceId } : {})
    })
  )
  await deps.log.writeTimeline({
    summary: 'core started',
    subject: 'meristem-core'
  })
})

// 退出时先关闭依赖再结束 telemetry，避免 span 或日志在进程退出前丢失。
process.on('SIGINT', () => {
  void deps.close().then(() => shutdownTelemetry()).then(() => process.exit(0))
})
