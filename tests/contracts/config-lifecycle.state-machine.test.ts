import { describe, expect, it } from 'bun:test'
import {
  type ConfigAction,
  type ConfigState,
  nextConfigState
} from './_helpers/config-lifecycle.ts'

describe('Config state machine', () => {
  const allActions: ConfigAction[] = [
    'validate',
    'publish',
    'apply_ack',
    'apply_fail',
    'rollback',
    'draft'
  ]

  it('draft + validate → validated', () => {
    expect(nextConfigState('draft', 'validate')).toBe('validated')
  })

  it('validated + publish → published', () => {
    expect(nextConfigState('validated', 'publish')).toBe('published')
  })

  it('published + apply_ack → applied', () => {
    expect(nextConfigState('published', 'apply_ack')).toBe('applied')
  })

  it('published + apply_fail → failed', () => {
    expect(nextConfigState('published', 'apply_fail')).toBe('failed')
  })

  it('published + rollback → rolled_back', () => {
    expect(nextConfigState('published', 'rollback')).toBe('rolled_back')
  })

  it('applied + rollback → rolled_back', () => {
    expect(nextConfigState('applied', 'rollback')).toBe('rolled_back')
  })

  it('failed + rollback → rolled_back', () => {
    expect(nextConfigState('failed', 'rollback')).toBe('rolled_back')
  })

  it('failed + validate → validated (recovery)', () => {
    expect(nextConfigState('failed', 'validate')).toBe('validated')
  })

  it('draft + publish → draft (no-op, must validate first)', () => {
    expect(nextConfigState('draft', 'publish')).toBe('draft')
  })

  it('draft + apply_ack → draft (no-op)', () => {
    expect(nextConfigState('draft', 'apply_ack')).toBe('draft')
  })

  it('validated + apply_ack → validated (no-op)', () => {
    expect(nextConfigState('validated', 'apply_ack')).toBe('validated')
  })

  it('validated + rollback → validated (no-op)', () => {
    expect(nextConfigState('validated', 'rollback')).toBe('validated')
  })

  it('applied + publish → applied (no-op)', () => {
    expect(nextConfigState('applied', 'publish')).toBe('applied')
  })

  it('rolled_back + any_action → rolled_back (terminal)', () => {
    for (const action of allActions) {
      expect(nextConfigState('rolled_back', action)).toBe('rolled_back')
    }
  })

  it('nextConfigState is pure: same input always returns same output', () => {
    for (let i = 0; i < 5; i++) {
      expect(nextConfigState('draft', 'validate')).toBe('validated')
      expect(nextConfigState('validated', 'publish')).toBe('published')
      expect(nextConfigState('published', 'apply_ack')).toBe('applied')
      expect(nextConfigState('applied', 'rollback')).toBe('rolled_back')
    }
  })

  it('full happy path: draft → validated → published → applied', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_ack')
    expect(state).toBe('applied')
  })

  it('ack failure path: draft → validated → published → failed → rolled_back', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_fail')
    expect(state).toBe('failed')

    state = nextConfigState(state, 'rollback')
    expect(state).toBe('rolled_back')
  })

  it('direct rollback from published: draft → validated → published → rolled_back', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'rollback')
    expect(state).toBe('rolled_back')
  })

  it('failed recovery: draft → validated → published → failed → validate → validated → published → applied', () => {
    let state: ConfigState = 'draft'

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_fail')
    expect(state).toBe('failed')

    state = nextConfigState(state, 'validate')
    expect(state).toBe('validated')

    state = nextConfigState(state, 'publish')
    expect(state).toBe('published')

    state = nextConfigState(state, 'apply_ack')
    expect(state).toBe('applied')
  })
})
