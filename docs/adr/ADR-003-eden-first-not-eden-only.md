# ADR-003: Eden-first, Not Eden-only

## Status

Accepted

## Context

Internal TypeScript services benefit from Eden's type-safe client/server contract over HTTP, but Meristem also needs external APIs, events, webhooks, and future cross-runtime boundaries.

## Decision

Internal TS service calls prefer Eden over HTTP. In the current MVP, `Core -> M-Policy`, `Core -> M-Log`, and `Core -> M-EventBus` use loopback-only HTTP plus a shared internal token. Eden is not the only contract system and is not a separate transport protocol. External APIs use REST + OpenAPI. Events use Event Schema. Cross-language and Wasm boundaries use REST/OpenAPI, Event Schema, or later WIT.

## Consequences

Internal TS paths stay productive while external and cross-runtime boundaries remain explicit. The cost is maintaining several contract forms.

## Revisit When

Revisit if Eden contracts leak into external boundaries or if maintaining multiple contract forms becomes inconsistent.
