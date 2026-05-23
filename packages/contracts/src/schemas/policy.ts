import * as Schema from 'effect/Schema'
import { permissions } from '../literals.ts'

// Permission literals are executable contracts so Core, M-Policy, and adapters cannot drift silently.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.3
export const PermissionSchema = Schema.Literal(...permissions)
export type PermissionFromSchema = typeof PermissionSchema.Type

