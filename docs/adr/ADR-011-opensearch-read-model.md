# ADR-011: OpenSearch Read Model

## Status

Accepted

## Context

Logs, audit queries, timeline aggregation, and behavior analysis need search and projection capabilities.

## Decision

Use OpenSearch for read models, search, log retrieval, and analysis queries. Elasticsearch is not used.

## Consequences

Search and analysis are separated from authoritative writes. OpenSearch unavailability must not block writes.

## Revisit When

Revisit if OpenSearch creates unacceptable operational burden or licensing constraints.
