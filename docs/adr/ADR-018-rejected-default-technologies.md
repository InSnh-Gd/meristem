# ADR-018: Rejected Default Technologies

## Status

Accepted

## Context

Meristem needs explicit negative decisions to prevent default architecture drift.

## Decision

Do not adopt these as defaults:

- GraphQL
- Temporal
- Tekton
- Raft
- Jotai
- Elasticsearch
- default Service Mesh
- gRPC everywhere
- every-service-own-database
- self-built Raft
- full-system mandatory CQRS

## Consequences

The default stack stays lighter and more contract-driven. Any exception requires a focused ADR.

## Revisit When

Revisit a single technology only with a concrete use case and a replacement or exception ADR.
