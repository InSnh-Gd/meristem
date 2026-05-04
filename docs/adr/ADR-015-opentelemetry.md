# ADR-015: OpenTelemetry

## Status

Accepted

## Context

Meristem needs correlation across Core, services, events, network paths, policy decisions, and logs.

## Decision

Use OpenTelemetry for traces, metrics, and log collection/correlation. M-Log remains Meristem's timeline, full log, audit, and analysis layer.

## Consequences

Trace and metric collection follows a standard ecosystem. Implementation must keep OpenTelemetry and M-Log responsibilities separate.

## Revisit When

Revisit if OpenTelemetry cannot represent required event or policy decision correlation.
