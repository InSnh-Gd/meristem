# ADR-016: Effect Without Effect Everywhere

## Status

Accepted

## Context

Some Meristem flows need strong modeling for effects, errors, resources, retries, cancellation, and lifecycle.

## Decision

Use Effect where complexity justifies it: service lifecycle, event consumers, M-Policy decision flow, M-Log pipeline, retries, timeout, and resource management. Do not require all simple code to become Effect-based.

## Consequences

Complex workflows get better safety without making the whole codebase harder to read.

## Revisit When

Revisit if Effect usage becomes inconsistent or if simple code is being over-modeled.
