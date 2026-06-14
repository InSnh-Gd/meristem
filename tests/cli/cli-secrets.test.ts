import { describe } from 'bun:test'
import { registerCliSecretsListCreateTests } from './cli-secrets-list-create.ts'
import { registerCliSecretsRotateDisableTests } from './cli-secrets-rotate-disable.ts'

// ---------------------------------------------------------------------------
// CLI secret tests exercise a focused mocked client surface.
//
// The helper narrows through `unknown` so the tests can provide only the
// secret methods they need without modeling the full client implementation.
// ---------------------------------------------------------------------------

describe('meristem CLI — secret', () => {
  registerCliSecretsListCreateTests()
  registerCliSecretsRotateDisableTests()
})
