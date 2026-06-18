import { describe, expect, it } from 'bun:test'
import { startBunScript, stopProcess } from '../helpers/process.ts'
import { waitFor, waitForHttpOk, waitForOutput, waitForReadyJson } from '../helpers/wait.ts'

describe('integration process harness', () => {
  it('starts a Bun subprocess, observes readiness text, and stops it cleanly', async () => {
    const process = startBunScript(
      "process.on('SIGINT', () => process.exit(0)); console.log('ready'); await Bun.sleep(5_000)"
    )

    await waitForOutput(() => process.stdout, {
      text: 'ready',
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

  it('waits for HTTP health and ready probes through shared helpers', async () => {
    let ready = false
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url)
        if (pathname === '/health') return Response.json({ ok: true })
        if (pathname === '/ready') return Response.json({ ready })
        return new Response('not found', { status: 404 })
      }
    })

    setTimeout(() => {
      ready = true
    }, 50)

    try {
      await waitForHttpOk({
        url: `http://127.0.0.1:${server.port}/health`,
        label: 'health endpoint',
        timeoutMs: 1_000,
        intervalMs: 25
      })
      await waitForReadyJson({
        url: `http://127.0.0.1:${server.port}/ready`,
        label: 'ready endpoint',
        timeoutMs: 1_000,
        intervalMs: 25
      })
    } finally {
      server.stop(true)
    }
  })
})
