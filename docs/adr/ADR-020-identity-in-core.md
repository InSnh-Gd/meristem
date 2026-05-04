# ADR-020: Identity in Core

## Status

Accepted

## Context

Base identity is foundational and needed by Core, policy, audit, CLI, UI, and services.

## Decision

Do not create M-Identity as a first-level module. Base identity belongs to Core, while authorization and risk belong to M-Policy.

## Consequences

Identity entrypoints remain close to Core. Authorization logic remains separate in M-Policy.

## Revisit When

Revisit if identity becomes a distinct product domain with lifecycle and contracts larger than Core should own.
