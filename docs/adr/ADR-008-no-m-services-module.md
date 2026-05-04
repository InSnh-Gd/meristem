# ADR-008: Microservices Are Implementation Form

## Status

Accepted

## Context

Creating an M-Services top-level module would confuse implementation form with product capability.

## Decision

Do not create M-Services as a first-level module. Microservices are the implementation form for M-* domains.

## Consequences

Capability boundaries stay domain-oriented. Service definitions still make each service explicit.

## Revisit When

Revisit if a dedicated service platform emerges as a separate product capability rather than an implementation mechanism.
