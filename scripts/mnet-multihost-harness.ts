import {
  readHarnessStatus,
  resetTopology,
  runPreflightChecks,
  startTopology,
  stopTopology
} from './mnet-multihost-harness-support.ts'

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function main(): Promise<void> {
  const command = Bun.argv[2] ?? 'status'

  switch (command) {
    case 'preflight': {
      const result = await runPreflightChecks()
      printJson(result)
      process.exit(result.ok ? 0 : 2)
      return
    }
    case 'start': {
      const status = await startTopology()
      printJson(status)
      process.exit(status.active ? 0 : 2)
      return
    }
    case 'status': {
      printJson(await readHarnessStatus())
      return
    }
    case 'stop': {
      await stopTopology(false)
      printJson({ ok: true, message: 'multi-host harness stopped' })
      return
    }
    case 'reset': {
      await resetTopology()
      printJson({ ok: true, message: 'multi-host harness reset' })
      return
    }
    default:
      throw new Error(`unknown multi-host harness command: ${command}`)
  }
}

await main()
