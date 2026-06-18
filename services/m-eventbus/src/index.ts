import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createEventBusApp } from './app.ts'
import { readEventBusPublisherRuntimeConfig } from './config.ts'
import { createEventBusPublisher } from './publisher.ts'

initTelemetry('m-eventbus')

// M-EventBus 进程自己持有 NATS 连接，对内暴露校验后的 HTTP 发布入口。
const nc = await connectToNats(process.env.NATS_URL ?? 'ws://localhost:4223')
const publisher = await createEventBusPublisher({ nc, ...readEventBusPublisherRuntimeConfig() })

const app = createEventBusApp({
  readiness: () => publisher.readiness(),
  publishMetricsSummary: () => publisher.publishMetricsSummary(),
  publish: (subject, event) => publisher.publish(subject, event),
  reportRejected: input => publisher.reportRejected(input)
})

const server = serveHttpApp('m-eventbus', app.fetch)

process.on('SIGINT', () => {
  void nc
    .drain()
    .then(() => server.stop())
    .then(() => shutdownTelemetry())
    .then(() => process.exit(0))
})

console.log(`m-eventbus listening on http://127.0.0.1:${internalServicePorts['m-eventbus']}`)
