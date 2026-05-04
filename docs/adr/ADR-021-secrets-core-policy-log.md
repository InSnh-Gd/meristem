# ADR-021: Secrets Split Across Core / Policy / Log

## Status

Accepted

## Context

Secrets need management, authorization, and audit, but a standalone M-Secret module would add a top-level domain too early.

## Decision

Do not create M-Secret. Core owns secretRef and secret management entrypoints. M-Policy authorizes secret access. M-Log audits secret operations.

## Consequences

Secret operations stay split by responsibility. Implementations must prevent secret values from entering logs, OpenSearch, LLM prompts, or UI error messages.

## Revisit When

Revisit if secret management grows into a separately deployable capability.
