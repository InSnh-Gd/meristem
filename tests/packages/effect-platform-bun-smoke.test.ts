import { describe, expect, it } from 'bun:test'
import * as PlatformBun from '@effect/platform-bun'
import { Effect } from 'effect'

describe('@effect/platform-bun compatibility smoke', () => {
  it('imports under Bun and executes a trivial Effect with BunRuntime', async () => {
    expect(PlatformBun.BunRuntime).toBeDefined()
    expect(typeof PlatformBun.BunRuntime.runMain).toBe('function')
    expect(PlatformBun.BunFileSystem).toBeDefined()

    let executed = false

    PlatformBun.BunRuntime.runMain(
      Effect.sync(() => {
        executed = true
      })
    )

    await Promise.resolve()

    expect(executed).toBe(true)
  })
})
