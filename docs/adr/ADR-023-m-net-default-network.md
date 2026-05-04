# ADR-023: M-Net Default Network

## Status

Proposed

## Context

M-Net needs a default interconnect strategy for Core, Stem, and Leaf nodes.

## Decision

Current default design: Core runs Headscale DERP Server, UDP is preferred, and Tailscale public DERP is a configurable and disableable fallback.

## Consequences

M-Net starts with a practical network baseline while preserving regional profiles and fallback controls.

## Revisit When

Revisit after the first M-Net prototype validates actual connectivity, fallback, and audit requirements.
