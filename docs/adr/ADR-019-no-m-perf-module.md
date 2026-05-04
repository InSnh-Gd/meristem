# ADR-019: No M-Perf Module

## Status

Accepted

## Context

Performance is cross-cutting and could become a vague module with unclear ownership.

## Decision

Do not create M-Perf as a first-level module. Performance work belongs inside each module's implementation strategy.

## Consequences

Performance remains tied to concrete hot paths and measurements. Cross-cutting performance utilities can exist as shared packages, not a top-level product domain.

## Revisit When

Revisit if Meristem gains a distinct performance orchestration product capability.
