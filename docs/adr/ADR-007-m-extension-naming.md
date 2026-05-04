# ADR-007: M-Plugin Renamed to M-Extension

## Status

Accepted

## Context

The term plugin implies the primary extension surface and encourages plugin-first architecture.

## Decision

Use M-Extension instead of M-Plugin. Extensions are supplemental and only used when microservices cannot satisfy the extension purpose.

## Consequences

Meristem avoids drifting into plugin-first architecture. Extension permissions, manifests, and lifecycle must remain explicit and low-privilege by default.

## Revisit When

Revisit only if a future product direction intentionally makes extension ecosystem a primary feature.
