# ADR-004: REST + OpenAPI, No GraphQL

## Status

Accepted

## Context

Meristem needs external API contracts that are stable, inspectable, tool-friendly, and compatible across languages.

## Decision

External APIs use REST + OpenAPI. GraphQL is not part of the current default architecture.

## Consequences

API versioning, documentation, and cross-language clients remain straightforward. The cost is that clients may need multiple REST calls unless BFF endpoints aggregate data.

## Revisit When

Revisit only if REST + BFF cannot support a proven UI or integration need without excessive endpoint sprawl.
