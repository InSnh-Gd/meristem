import { describe, expect, it } from 'bun:test'
import path from 'node:path'
import {
  type PacketForwardingFinding,
  scanPacketForwardingBoundaries
} from './_helpers/packet-forwarding-guard.ts'

const repoRoot = path.resolve(import.meta.dir, '../..')
const productionRoots = [
  path.join(repoRoot, 'apps/core/src'),
  path.join(repoRoot, 'services/m-net/src')
]
const fixtureRoot = path.join(import.meta.dir, 'fixtures/packet-forwarding-guard')

/**
 * 把守卫结果压成稳定文本，便于证据文件和失败信息直接复用。
 */
function formatFindings(findings: PacketForwardingFinding[]): string {
  return findings
    .map(finding => `${finding.rule} :: ${finding.filePath} :: ${finding.detail}`)
    .join('\n')
}

describe('packet forwarding architecture guard', () => {
  it('passes on production Core and M-Net control-plane code', () => {
    const findings = scanPacketForwardingBoundaries(productionRoots)
    expect(findings).toEqual([])
  })

  it('fails on the intentional packet-forwarding fixture', () => {
    const findings = scanPacketForwardingBoundaries([fixtureRoot])
    expect(findings.length).toBeGreaterThan(0)
    expect(formatFindings(findings)).toContain('forbidden-dgram-import')
    expect(formatFindings(findings)).toContain('forbidden-raw-tcp-relay-server')
    expect(formatFindings(findings)).toContain('forbidden-wireguard-private-key-field')
    expect(formatFindings(findings)).toContain('forbidden-relay-handler')
  })
})
