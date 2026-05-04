# ADR-013: Timeline / Full / Audit Logs

## Status

Accepted

## Context

Different audiences need different log views. Audit facts also need stronger trust than ordinary logs.

## Decision

M-Log uses Timeline Log, Full Log, and Audit Log. Audit Log is independent and high-permission, not a category inside Full Log.

## Consequences

Human status, operational debugging, and high-trust audit review have separate semantics. Implementation must prevent Timeline or Full Log from replacing Audit.

## Revisit When

Revisit if a stronger audit storage mechanism is needed, but not to collapse the three log layers.
