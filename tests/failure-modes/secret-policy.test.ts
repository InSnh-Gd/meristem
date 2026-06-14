import { describe } from 'bun:test'
import { registerSecretPolicyDegradedOpsTests } from './secret-policy-degraded-ops.ts'
import { registerSecretPolicyRbacTests } from './secret-policy-rbac.ts'
import { registerSecretPolicyStateTests } from './secret-policy-state.ts'

// ---------------------------------------------------------------------------
// SecretRef v0.1 Policy and Audit Failure-Mode Tests
//
// These tests verify fail-closed secret operations and RBAC enforcement.
//
// Sentinel prefix: SEC-FM-POLICY
// ---------------------------------------------------------------------------

describe('SecretRef v0.1 policy failure modes', () => {
  registerSecretPolicyDegradedOpsTests()
  registerSecretPolicyRbacTests()
  registerSecretPolicyStateTests()
})
