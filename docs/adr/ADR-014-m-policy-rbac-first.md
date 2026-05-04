# ADR-014: M-Policy RBAC First

## Status

Accepted

## Context

M-Policy will eventually handle confidence, suspicion, risk, and multi-party decisions, but v0 must stay small.

## Decision

Start M-Policy with RBAC. Add operation danger levels, confidence, suspicion, LLM explanations, and multi-decision flow in later phases.

## Consequences

v0 has a testable permission foundation. Advanced policy work cannot bypass RBAC or Audit Log.

## Revisit When

Revisit after Phase 5 when RBAC is implemented and risk primitives can be safely layered.
