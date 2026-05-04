# ADR-010: PostgreSQL Write Model

## Status

Proposed

## Context

Meristem needs an authoritative write model for users, roles, permissions, nodes, service definitions, config versions, secretRefs, and key resources.

## Decision

PostgreSQL is the provisional authoritative write model.

## Consequences

Meristem gets strong relational modeling and transactional semantics. The cost is operational dependency on PostgreSQL and migration discipline.

## Revisit When

Revisit before production freeze if another RDBMS or storage model is proven superior for the authoritative state set.
