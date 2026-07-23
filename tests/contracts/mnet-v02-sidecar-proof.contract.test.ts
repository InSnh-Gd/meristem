import { describe, expect, it } from 'bun:test'

describe('M-Net v0.2 sidecar proof command', () => {
  it('exits nonzero and reports typed prerequisite-missing when prerequisites are absent', async () => {
    const child = Bun.spawn([process.execPath, 'scripts/mnet-v02-sidecar-proof.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: '/nonexistent-meristem-sidecar-proof-home',
        NETBIRD_SIGNAL_URL: '',
        MERISTEM_MNET_SIGNAL_URL: '',
        NETBIRD_STUN_URL: '',
        MERISTEM_MNET_STUN_URL: ''
      },
      stdout: 'pipe',
      stderr: 'pipe'
    })

    const output = await new Response(child.stdout).text()
    expect(await child.exited).not.toBe(0)

    const report: { verdict: string; results: Array<{ status: string }> } = JSON.parse(output)
    expect(report.verdict).toBe('prerequisite-missing')
    expect(report.results.some(result => result.status === 'prerequisite-missing')).toBe(true)
  })
})
