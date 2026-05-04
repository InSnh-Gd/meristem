# ADR-022: SvelteKit + Elysia Integration

## Status

Accepted

## Context

M-UI needs a server-rendered operational interface while Core APIs remain Elysia-based.

## Decision

Use SvelteKit + SDUI for M-UI and integrate it with Elysia at the route level. Keep API prefixes clear.

## Consequences

M-UI can be deployed together with Core initially while preserving later split deployment. BFF routes can aggregate data through Eden.

## Revisit When

Revisit if route-level integration creates deployment or ownership problems.
