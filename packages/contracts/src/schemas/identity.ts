import * as Schema from 'effect/Schema'
import { actorIds } from '../literals.ts'

// ActorId is a boundary literal because auth, policy, audit, and BFF session views all share it.
// Source: docs/plans/2026-05-23-effect-projection-hardening.md §2.2
export const ActorIdSchema = Schema.Literal(...actorIds)
export type ActorIdFromSchema = typeof ActorIdSchema.Type

