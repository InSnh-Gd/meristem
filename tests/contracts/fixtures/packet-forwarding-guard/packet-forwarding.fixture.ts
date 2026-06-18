import { createSocket } from 'node:dgram'
import { createServer } from 'node:net'

export const wireguardPrivateKey = 'fixture-private-key'

export function handleWstunnelRelay(): void {
  const socket = createSocket('udp4')
  socket.close()

  const server = createServer()
  server.close()
}
