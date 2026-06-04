import { describe, expect, it } from 'bun:test'
import * as Schema from 'effect/Schema'
import {
  SduiV02RouteRegistrySchema,
  SduiV02RouteSchema
} from '../../packages/contracts/src/schemas/ui.ts'

const requiredSduiV02RouteIds = [
  'control-room.overview',
  'nodes.index',
  'nodes.detail',
  'timeline.index',
  'audit.index',
  'policy.decisions',
  'services.index'
] as const

const forbiddenComponentKinds = [
  'Toast',
  'Snackbar',
  'DecorativeCard',
  'MarketingBanner',
  'Confetti',
  'Carousel',
  'FloatingActionButton',
  'UnscopedDropdownActionMenu',
  'UnlabeledDestructiveIconButton'
] as const

const validRouteV02 = {
  id: 'control-room.overview',
  title: 'Control Room Overview',
  requiredPermissions: ['timeline:read'],
  stateSources: ['authoritative', 'event', 'cache', 'read-model', 'log', 'audit', 'policy'],
  degradedState: {
    enabled: true,
    reason: 'audit backend degraded'
  },
  components: [
    {
      kind: 'TimelinePanel',
      id: 'timeline-main'
    }
  ]
} as const

describe('SDUI v0.2 route schema', () => {
  it('accepts valid v0.2 routes with stateSources, degradedState, and requiredPermissions', () => {
    const decoded = Schema.decodeUnknownSync(SduiV02RouteSchema)(validRouteV02)

    expect(decoded.id).toBe('control-room.overview')
    expect(decoded.requiredPermissions).toEqual(['timeline:read'])
    expect(decoded.stateSources).toEqual([
      'authoritative',
      'event',
      'cache',
      'read-model',
      'log',
      'audit',
      'policy'
    ])
    expect(decoded.degradedState.enabled).toBe(true)
  })

  it('unknown component kind is rejected', () => {
    const unknownKindRoute = {
      ...validRouteV02,
      components: [
        {
          kind: 'UnknownComponentKind',
          id: 'bad-component'
        }
      ]
    } as const

    expect(() => Schema.decodeUnknownSync(SduiV02RouteSchema)(unknownKindRoute)).toThrow()
  })

  it('forbidden component kinds are rejected', () => {
    for (const forbiddenKind of forbiddenComponentKinds) {
      const routeWithForbiddenKind = {
        ...validRouteV02,
        components: [
          {
            kind: forbiddenKind,
            id: `forbidden-${forbiddenKind.toLowerCase()}`
          }
        ]
      } as const

      expect(() => Schema.decodeUnknownSync(SduiV02RouteSchema)(routeWithForbiddenKind)).toThrow()
    }
  })

  it('route registry contains required SDUI v0.2 route IDs', () => {
    const registry = {
      schemaVersion: 'sdui@0.2.0',
      routes: requiredSduiV02RouteIds.map((id) => ({
        ...validRouteV02,
        id
      }))
    } as const

    const decoded = Schema.decodeUnknownSync(SduiV02RouteRegistrySchema)(registry)
    const routeIds = decoded.routes.map((route) => route.id)

    // Bun 的 toEqual 重载在 strict 模式下不接受 readonly tuple；
    // 展开为普通字符串列表进行比较，语义不变且消除 TS2769。
    expect(routeIds).toEqual([...requiredSduiV02RouteIds])
    expect(new Set(routeIds).size).toBe(7)
  })

  it('every route declares state sources', () => {
    const registry = {
      schemaVersion: 'sdui@0.2.0',
      routes: requiredSduiV02RouteIds.map((id) => ({
        ...validRouteV02,
        id
      }))
    } as const

    const decoded = Schema.decodeUnknownSync(SduiV02RouteRegistrySchema)(registry)
    for (const route of decoded.routes) {
      expect(route.stateSources.length).toBeGreaterThan(0)
    }
  })
})
