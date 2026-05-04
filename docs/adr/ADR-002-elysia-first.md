# ADR-002: Elysia-first

## Status

Accepted

## Context

Core and internal services need a lightweight TypeScript backend model with strong schema and type inference.

## Decision

Meristem backend services use ElysiaJS as the default organization model. Elysia method chains, plugins, schema, lifecycle, type inference, and Eden contracts are part of the engineering baseline.

## Consequences

Backend services can share a consistent typed style. Elysia method chains must be documented because complex chains can otherwise become unreadable.

## Revisit When

Revisit if Elysia blocks required lifecycle, OpenAPI, deployment, or observability behavior that cannot be solved without heavy workarounds.
