# ADR-005: Lightweight Microservices

## Status

Accepted

## Context

Meristem needs service isolation, lifecycle management, and fault boundaries, but should not inherit the cost of heavy microservice stacks by default.

## Decision

Use lightweight modern microservices inside the Monorepo. Do not default to service mesh, gRPC everywhere, every-service-own-database, or heavy orchestration.

## Consequences

Services remain readable, testable, and contract-driven. The cost is that some advanced platform capabilities must be added deliberately when justified.

## Revisit When

Revisit if deployment scale or organizational boundaries require heavier infrastructure and the cost is documented.
