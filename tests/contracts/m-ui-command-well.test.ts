import { describe, expect, it } from 'bun:test'
import * as Either from 'effect/Either'
import * as Schema from 'effect/Schema'
import { deriveNoopCommandEligibility } from '../../services/m-ui-bff/src/command-well/eligibility.ts'
import { CommandWellEligibilitySchema } from '../../packages/contracts/src/index.ts'
import type { MNode, Permission } from '../../packages/contracts/src/index.ts'

const leafNode: MNode = {
  id: 'node-leaf-1',
  kind: 'leaf',
  name: 'leaf-1',
  mode: 'simulated',
  status: 'healthy',
  reachability: 'reachable',
  createdAt: '2026-05-23T00:00:00.000Z',
  lastSeenAt: '2026-05-23T00:00:00.000Z',
  capabilities: []
}

function derive(permissions: Permission[], node: MNode) {
  return deriveNoopCommandEligibility({ permissions }, node)
}

describe('CommandWell eligibility display shaping', () => {
  it('enables noop only from Core-visible session permissions and Leaf reachability', () => {
    const result = derive(['task:submit'], leafNode)

    expect(Either.isRight(Schema.decodeUnknownEither(CommandWellEligibilitySchema)(result))).toBe(true)
    expect(result.state).toBe('enabled')
    if (result.state === 'enabled') {
      expect(result.command.action).toBe('task:submit')
      expect(result.command.resource).toBe('node-leaf-1')
      expect(result.command.requiresPolicy).toBe(true)
      expect(result.command.requiresAudit).toBe(true)
    }
  })

  it('returns disabled explanations without creating policy or audit facts', () => {
    const noPermission = derive([], leafNode)
    const wrongKind = derive(['task:submit'], { ...leafNode, id: 'node-stem-1', kind: 'stem' })
    const unreachable = derive(['task:submit'], { ...leafNode, reachability: 'unreachable' })

    expect(noPermission.state).toBe('disabled')
    expect(noPermission.state === 'disabled' ? noPermission.disabled.code : '').toBe('missing_permission')
    expect(wrongKind.state === 'disabled' ? wrongKind.disabled.code : '').toBe('wrong_node_kind')
    expect(unreachable.state === 'disabled' ? unreachable.disabled.code : '').toBe('node_unreachable')
  })
})
