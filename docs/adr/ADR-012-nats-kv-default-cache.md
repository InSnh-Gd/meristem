# ADR-012: NATS KV as Default Cache

## Status

Accepted

## Context

Meristem needs lightweight cache and KV behavior without making Redis a default base dependency.

## Decision

Use NATS KV / MATS as the default cache. Redis / KeyDB are supplemental only when NATS KV is insufficient.

## Consequences

The default stack remains lighter. Advanced cache semantics require explicit justification and dependency documentation.

## Revisit When

Revisit if v0 or v1 functionality repeatedly requires Redis-only semantics.
