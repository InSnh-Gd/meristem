import { initTelemetry, shutdownTelemetry } from '../../../packages/telemetry/src/index.ts'
import { createMUiBffApp } from './app.ts'

initTelemetry('m-ui-bff')

const port = Number(process.env.MERISTEM_BFF_PORT ?? '3200')
const coreBaseUrl = process.env.MERISTEM_CORE_URL ?? 'http://localhost:3000'
const taskBaseUrl = process.env.MERISTEM_TASK_URL ?? 'http://127.0.0.1:3105'
const app = createMUiBffApp({ coreBaseUrl, taskBaseUrl })

// m-ui-bff 是面向 SvelteKit shell 的公开入口，不经过内部 loopback 认证。
const server = Bun.serve({
  hostname: '0.0.0.0',
  port,
  fetch: app.fetch,
  error() {
    return new Response('internal server error', { status: 500 })
  }
})

console.log(`m-ui-bff listening on http://0.0.0.0:${port}`)

process.on('SIGINT', () => {
  server.stop(true)
  void shutdownTelemetry().then(() => process.exit(0))
})
