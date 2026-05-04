# ADR-024: M-Net CN Regional Profile

## Status

Proposed

## Context

Some network environments require regional routing and fallback behavior that the default M-Net strategy may not satisfy.

## Decision

Define M-Net CN as the first Regional Network Profile. Asian Stem Nodes may serve DERP. Mainland nodes without public network access use TCP interconnect. Asian Stem Nodes connect to Core over TCP.

## Consequences

Regional behavior is explicit and auditable. M-Net CN remains optional and controlled by M-Policy.

## Revisit When

Revisit after concrete regional connectivity testing or if M-Net CN introduces unacceptable operational risk.
