# ADR-001: TypeScript-first

## Status

Accepted

## Context

Meristem needs one default language for Core, microservices, contracts, tests, CLI, UI tooling, and shared packages. The system depends heavily on explicit contracts and schema narrowing.

## Decision

TypeScript is the default implementation language for Meristem. Wasm, Zig, and other runtimes are allowed only for performance-critical paths, isolation, low-resource nodes, or special runtime capabilities.

## Consequences

Shared type contracts become practical across Core, services, CLI, UI, and tests. The cost is that non-TypeScript integrations need REST/OpenAPI, Event Schema, or later WIT boundaries.

## Revisit When

Revisit if a core subsystem cannot meet isolation, portability, or performance goals with TypeScript and a bounded non-TypeScript runtime is required.
