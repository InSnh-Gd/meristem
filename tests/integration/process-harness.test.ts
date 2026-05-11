import { describe, expect, it } from 'bun:test'
import { startBunScript, stopProcess } from '../helpers/process.ts'
import { waitFor } from '../helpers/wait.ts'

describe('integration process harness', () => {
  it('starts a Bun subprocess, observes readiness text, and stops it cleanly', async () => {
    const process = startBunScript(
      "process.on('SIGINT', () => process.exit(0)); console.log('ready'); await Bun.sleep(5_000)"
    )

    await waitFor(() => process.stdout.includes('ready'), {
      label: 'bun subprocess readiness',
      timeoutMs: 2_000,
      intervalMs: 25
    })

    expect(await stopProcess(process)).toBe(0)
  })

  it('fails waitFor when the condition never becomes true', async () => {
    await expect(
      waitFor(() => false, {
        label: 'never-ready',
        timeoutMs: 100,
        intervalMs: 10
      })
    ).rejects.toThrow('never-ready')
  })
})
