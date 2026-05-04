# ADR-017: APISIX Optional

## Status

Accepted

## Context

APISIX can provide production gateway features, but making it default would increase baseline complexity.

## Decision

APISIX is an optional deployment component, not a Core default dependency.

## Consequences

Default deployments stay lighter. Production deployments can still use APISIX for TLS termination, rate limiting, auth preflight, webhook ingress, gray release, and traffic control.

## Revisit When

Revisit if production needs make APISIX effectively mandatory and the default deployment contract changes.
