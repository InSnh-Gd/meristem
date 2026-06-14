import { describe } from 'bun:test'
import { registerConfigLifecycleAuthTests } from './config-lifecycle-auth.test-support.ts'
import { registerConfigLifecycleDegradedOpsTests } from './config-lifecycle-degraded-ops.ts'
import { registerConfigLifecycleStateTests } from './config-lifecycle-state.test-support.ts'

// ---------------------------------------------------------------------------
// Config Lifecycle v0.1 Failure-Mode Tests
//
// These tests verify fail-closed behavior for mounted config lifecycle routes.
//
// Sentinel values use unique prefixes: CFG-FM-POLICY, CFG-FM-AUDIT,
// CFG-FM-ACK, CFG-FM-ROLLBACK
// ---------------------------------------------------------------------------

describe('Config lifecycle failure modes', () => {
  registerConfigLifecycleDegradedOpsTests()
  registerConfigLifecycleStateTests()
  registerConfigLifecycleAuthTests()
})
