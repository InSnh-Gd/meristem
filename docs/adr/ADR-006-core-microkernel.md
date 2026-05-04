# ADR-006: Core Microkernel

## Status

Accepted

## Context

Core can easily become a hidden coupling center if it directly owns all M-* logic.

## Decision

Core is a microkernel. It owns bootstrap, base configuration, identity entrypoint, service lifecycle entrypoint, Elysia app composition, REST/OpenAPI, Eden aggregation, M-CLI entrypoint, safety mode, minimal log and policy entrypoints, secretRef entrypoint, node registration, and health checks.

## Consequences

Complex capabilities must live in M-* domains or services. This keeps Core safe and testable but requires explicit service definitions and contracts.

## Revisit When

Revisit if a capability cannot be safely implemented outside Core and its addition preserves the microkernel boundary.
