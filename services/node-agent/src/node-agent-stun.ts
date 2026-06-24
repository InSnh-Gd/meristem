/**
 * 轻量级 STUN 客户端，用于发现节点 WireGuard 监听端口的公网映射地址。
 *
 * 使用 RFC 5389 STUN Binding Request 通过 UDP 发送到公共 STUN 服务器，
 * 解析 XOR-MAPPED-ADDRESS 或 MAPPED-ADDRESS 属性获取公网 endpoint。
 *
 * 仅用于云主机 1:1 NAT 场景（Elastic IP），不处理对称 NAT。
 */

import { createSocket, type Socket } from 'node:dgram'

const STUN_MAGIC_COOKIE = 0x2112a442
const STUN_BINDING_REQUEST = 0x0001
const STUN_ATTR_MAPPED_ADDRESS = 0x0001
const STUN_ATTR_XOR_MAPPED_ADDRESS = 0x0020

export type StunEndpoint = {
  readonly ip: string
  readonly port: number
}

export type StunResult =
  | { readonly ok: true; readonly endpoint: StunEndpoint }
  | { readonly ok: false; readonly reason: string }

const DEFAULT_STUN_SERVERS = [
  { host: 'stun.l.google.com', port: 19302 },
  { host: 'stun1.l.google.com', port: 19302 },
  { host: 'stun2.l.google.com', port: 19302 },
  { host: 'stun.miwifi.com', port: 3478 }
] as const

const STUN_TIMEOUT_MS = 5000

export function queryStunServer(
  server: { host: string; port: number },
  timeoutMs: number = STUN_TIMEOUT_MS
): Promise<StunResult> {
  return new Promise(resolve => {
    const socket: Socket = createSocket({ type: 'udp4' })
    let settled = false

    const cleanup = (result: StunResult) => {
      if (settled) return
      settled = true
      socket.close()
      resolve(result)
    }

    socket.on('error', (error: Error) => {
      cleanup({ ok: false, reason: `STUN socket error: ${error.message}` })
    })

    socket.on('message', (msg: Buffer) => {
      const result = parseStunResponse(new Uint8Array(msg))
      cleanup(result)
    })

    const request = Buffer.alloc(20)
    request.writeUInt16BE(STUN_BINDING_REQUEST, 0)
    request.writeUInt16BE(0, 2)
    request.writeUInt32BE(STUN_MAGIC_COOKIE, 4)
    crypto.getRandomValues(request.subarray(8, 20))

    socket.send(request, server.port, server.host, (error: Error | null) => {
      if (error) {
        cleanup({ ok: false, reason: `STUN send failed: ${error.message}` })
      }
    })

    setTimeout(() => {
      cleanup({ ok: false, reason: `STUN timeout after ${timeoutMs}ms` })
    }, timeoutMs)
  })
}

export async function discoverPublicEndpoint(
  timeoutMs: number = STUN_TIMEOUT_MS
): Promise<StunResult> {
  for (const server of DEFAULT_STUN_SERVERS) {
    const result = await queryStunServer(server, timeoutMs)
    if (result.ok) return result
  }
  return { ok: false, reason: 'all STUN servers failed' }
}

function parseStunResponse(data: Uint8Array): StunResult {
  if (data.length < 20) {
    return { ok: false, reason: 'STUN response too short' }
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const msgType = view.getUint16(0)
  if (msgType !== 0x0101) {
    return { ok: false, reason: `STUN response error type: 0x${msgType.toString(16)}` }
  }

  const msgLength = view.getUint16(2)
  let offset = 20

  while (offset + 4 <= 20 + msgLength) {
    const attrType = view.getUint16(offset)
    const attrLength = view.getUint16(offset + 2)
    offset += 4

    if (offset + attrLength > data.length) break

    if (attrType === STUN_ATTR_XOR_MAPPED_ADDRESS) {
      const result = parseXorMappedAddress(data, offset, attrLength)
      if (result.ok) return result
    } else if (attrType === STUN_ATTR_MAPPED_ADDRESS) {
      const result = parseMappedAddress(data, offset, attrLength)
      if (result.ok) return result
    }

    offset += attrLength + ((4 - (attrLength % 4)) % 4)
  }

  return { ok: false, reason: 'no MAPPED-ADDRESS attribute in STUN response' }
}

function parseMappedAddress(data: Uint8Array, offset: number, _length: number): StunResult {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const family = view.getUint8(offset + 1)
  const port = view.getUint16(offset + 2)

  if (family === 0x01) {
    const ip = `${view.getUint8(offset + 4)}.${view.getUint8(offset + 5)}.${view.getUint8(offset + 6)}.${view.getUint8(offset + 7)}`
    return { ok: true, endpoint: { ip, port } }
  }

  return { ok: false, reason: `unsupported address family: ${family}` }
}

function parseXorMappedAddress(data: Uint8Array, offset: number, _length: number): StunResult {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const family = view.getUint8(offset + 1)
  const xorPort = view.getUint16(offset + 2)
  const port = xorPort ^ (STUN_MAGIC_COOKIE >>> 16)

  if (family === 0x01) {
    const xorIp = view.getUint32(offset + 4)
    const ip = xorIp ^ STUN_MAGIC_COOKIE
    const ipStr = `${(ip >>> 24) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 8) & 0xff}.${ip & 0xff}`
    return { ok: true, endpoint: { ip: ipStr, port } }
  }

  return { ok: false, reason: `unsupported XOR address family: ${family}` }
}
