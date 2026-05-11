import { internalServicePorts, serveHttpApp } from '../../../packages/internal-http/src/index.ts'
import { connectToNats } from '../../../packages/nats-rpc/src/index.ts'
import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createEventBusApp } from './app.ts'

initTelemetry('m-eventbus')

// M-EventBus 进程自己持有 NATS 连接，对内暴露校验后的 HTTP 发布入口。
const nc = await connectToNats(process.env.NATS_URL ?? 'ws://localhost:4223')

const app = createEventBusApp({
  async readiness() {
    try {
      await nc.flush()
      return { ready: true }
    } catch {
      return { ready: false }
    }
  },
  async publish(subject, event) {
    // 事件进总线前已经过 internal auth 和 envelope 校验，这里只做最薄的 publish 适配。
    nc.publish(subject, JSON.stringify(event))
    return { eventId: event.id }
  }
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
