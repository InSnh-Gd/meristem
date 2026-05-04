# ADR-009: NATS for M-EventBus

## Status

Accepted

## Context

Meristem needs lightweight event, command, sync, and interconnect-information flow.

## Decision

Use NATS as the M-EventBus backbone.

## Consequences

Event-driven architecture remains lightweight. Consumers must handle at-least-once delivery, idempotency, schema validation, and degradation when NATS is unavailable.

## Revisit When

Revisit if NATS cannot satisfy delivery, topology, persistence, or operational requirements after concrete implementation experience.
