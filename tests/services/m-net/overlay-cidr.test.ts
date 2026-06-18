import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_MNET_OVERLAY_CIDR,
  parseOverlayCidr
} from '../../../services/m-net/src/data-plane/overlay-cidr.ts'

describe('parseOverlayCidr', () => {
  it('parses the documented default overlay range', () => {
    const result = parseOverlayCidr(DEFAULT_MNET_OVERLAY_CIDR)

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error.message)
    expect(result.value).toEqual({
      cidr: '100.96.0.0/12',
      baseAddress: '100.96.0.0',
      prefixLength: 12,
      networkAddress: '100.96.0.0',
      broadcastAddress: '100.111.255.255',
      addressCount: 1_048_576
    })
  })

  it('rejects malformed and out-of-range CIDR input', () => {
    expectInvalidOverlayCidr('', 'mnet.overlay_cidr.empty')
    expectInvalidOverlayCidr('100.96.0.0', 'mnet.overlay_cidr.invalid_format')
    expectInvalidOverlayCidr('300.96.0.0/12', 'mnet.overlay_cidr.invalid_octet')
    expectInvalidOverlayCidr('100.96.0.0/33', 'mnet.overlay_cidr.invalid_prefix')
  })

  it('rejects CIDR input with host bits set', () => {
    expectInvalidOverlayCidr('100.96.0.1/12', 'mnet.overlay_cidr.host_bits_set')
  })
})

function expectInvalidOverlayCidr(input: string, code: string): void {
  const result = parseOverlayCidr(input)

  expect(result.ok).toBe(false)
  if (result.ok) throw new Error(`expected ${input} to be invalid`)
  expect(result.error.code).toBe(code)
}
