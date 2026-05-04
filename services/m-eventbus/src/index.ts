import { connect } from '@nats-io/transport-node'
import { createEventEnvelope, validateEventEnvelope, type MEventEnvelope } from '../../../packages/events/src/index.ts'
import { serveJsonRequests, subjects } from '../../../packages/nats-rpc/src/index.ts'

type PublishRequest = {
  subject: string
  event: MEventEnvelope
}

type PublishResponse =
  | { ok: true; eventId: string }
  | { ok: false; errors: string[] }

const nc = await connect({ servers: process.env.NATS_URL ?? 'nats://localhost:4222' })

await serveJsonRequests<PublishRequest, PublishResponse>(nc, subjects.eventPublish, async (request) => {
  const validation = validateEventEnvelope(request.event)
  if (!validation.ok) return { ok: false, errors: validation.error }

  nc.publish(request.subject, JSON.stringify(request.event))
  return { ok: true, eventId: request.event.id }
})

nc.publish(
  'core.lifecycle.started.v0',
  JSON.stringify(createEventEnvelope({ type: 'm-eventbus.started', source: 'm-eventbus', payload: {} }))
)

process.on('SIGINT', () => {
  void nc.drain().then(() => process.exit(0))
})

console.log(`m-eventbus listening on ${subjects.eventPublish}`)

