import { describe, it } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createEventEnvelope, validateEventEnvelope } from '../../packages/events/src/index.ts'
import { decidePermission } from '../../packages/policy/src/index.ts'
import { redactSecrets } from '../../packages/common/src/secret-redaction.ts'
import {
  nextProfileState,
  type ProfileAction,
  type ProfileState
} from '../../services/m-net/src/profile-state-machine.ts'

type TraceSample = {
  ts: number
  label: string
}

type FlamegraphTrace = {
  name: string
  startTime: string
  samples: TraceSample[]
}

type FoldedTrace = {
  stack: string
  samples: TraceSample[]
}

const outputDirectory = tmpdir()
const foldedOutputPath = join(outputDirectory, 'meristem-flamegraph.folded')
const foldedTraces: FoldedTrace[] = []

function createTrace(name: string): { start: number; trace: FlamegraphTrace } {
  return {
    start: performance.now(),
    trace: {
      name,
      startTime: new Date().toISOString(),
      samples: []
    }
  }
}

function sampleTrace(trace: FlamegraphTrace, start: number, label: string): void {
  trace.samples.push({
    ts: performance.now() - start,
    label
  })
}

function writeTrace(path: string, trace: FlamegraphTrace, stack: string): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(path, JSON.stringify(trace, null, 2))
  foldedTraces.push({ stack, samples: trace.samples })
}

function writeFoldedTrace(): void {
  const lines = foldedTraces.map(({ stack, samples }) => `${stack} ${samples.length}`)
  writeFileSync(foldedOutputPath, `${lines.join('\n')}\n`)
}

describe('CPU flame graph profiles', () => {
  it('profile state machine hot path', () => {
    const outputPath = join(outputDirectory, 'meristem-flamegraph-sm.json')
    const actions: readonly ProfileAction[] = [
      'enable_request',
      'enable_success',
      'disable_request',
      'disable_success'
    ]
    let state: ProfileState = 'disabled'
    const { start, trace } = createTrace('profile state machine hot path')

    for (let index = 0; index < 500000; index++) {
      const action = actions[index % actions.length] ?? 'enable_request'
      state = nextProfileState(state, action)
      if (index % 1000 === 0) {
        sampleTrace(trace, start, `nextProfileState:${state}:${action}`)
      }
    }

    writeTrace(outputPath, trace, 'profile-sm;nextProfileState')
    console.log(`[perf] flamegraph-sm: ${trace.samples.length} samples written to ${outputPath}`)
  })

  it('secret redaction hot path', () => {
    const outputPath = join(outputDirectory, 'meristem-flamegraph-redact.json')
    const input =
      'token=abc123 secret=top-secret value=plain {"value":"json-secret","value_ciphertext":"cipher","plaintext":"raw"} password ignored padding for two hundred chars '.padEnd(
        200,
        'x'
      )
    const { start, trace } = createTrace('secret redaction hot path')
    let redacted = ''

    for (let index = 0; index < 200000; index++) {
      redacted = redactSecrets(input)
      if (index % 500 === 0) {
        sampleTrace(trace, start, `redactSecrets:${redacted.length}`)
      }
    }

    writeTrace(outputPath, trace, 'redact;redactSecrets;regex-replace')
    console.log(`[perf] flamegraph-redact: ${trace.samples.length} samples written`)
  })

  it('event validation hot path', () => {
    const outputPath = join(outputDirectory, 'meristem-flamegraph-validate.json')
    const events = Array.from({ length: 1000 }, (_, index) =>
      createEventEnvelope({
        type: `perf.event.${index}`,
        source: 'tests/perf/flamegraph-cpu',
        payload: { index, value: `payload-${index}` },
        correlationId: `corr-${index}`,
        traceId: `trace-${index}`,
        subject: `subject-${index}`
      })
    )
    const { start, trace } = createTrace('event validation hot path')

    for (let index = 0; index < 100000; index++) {
      const result = validateEventEnvelope(events[index % events.length])
      if (index % 200 === 0) {
        sampleTrace(trace, start, `validateEventEnvelope:${result.ok ? 'ok' : 'err'}`)
      }
    }

    writeTrace(outputPath, trace, 'validate;validateEventEnvelope;field-check')
    console.log(`[perf] flamegraph-validate: ${trace.samples.length} samples written`)
  })

  it('policy decision hot path', () => {
    const outputPath = join(outputDirectory, 'meristem-flamegraph-policy.json')
    const permissions = [
      'core:read',
      'network:read',
      'network:create',
      'task:submit',
      'service:reload',
      'audit:read'
    ] as const
    const { start, trace } = createTrace('policy decision hot path')

    for (let index = 0; index < 500000; index++) {
      const action = permissions[index % permissions.length] ?? 'core:read'
      const decision = decidePermission({
        actor: index % 2 === 0 ? 'operator' : 'viewer',
        action,
        permissions: permissions.slice(0, (index % permissions.length) + 1),
        resource: `resource-${index % 64}`
      })
      if (index % 1000 === 0) {
        sampleTrace(trace, start, `decidePermission:${decision.result}:${action}`)
      }
    }

    writeTrace(outputPath, trace, 'policy;decidePermission;permission-check')
    writeFoldedTrace()
    console.log(`[perf] flamegraph-policy: ${trace.samples.length} samples written`)
  })
})
