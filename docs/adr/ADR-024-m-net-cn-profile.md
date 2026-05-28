# ADR-024: M-Net CN Regional Profile

## Status

Accepted for control-plane Regional Profile lifecycle. Data-plane DERP / TCP / UDP behavior remains deferred.

## Context

Some network environments require regional routing and fallback behavior that the default M-Net strategy may not satisfy.

## Decision

Define M-Net CN as the first Regional Network Profile.

In Phase 13, M-Net CN is implemented as a control-plane profile lifecycle:

- versioned profile definition: `m-net-cn@0.1.0`.
- per-network enable / disable through M-Net-owned REST and CLI surfaces.
- M-Policy approval for enable.
- M-Policy allow + Audit for disable.
- M-Net-owned profile state, transitions, and suspended enable operations.
- Audit, Timeline, Full Log, and profile lifecycle events.
- rollback to `m-net-default@0.1.0` by disabling the profile for a network.

The profile records intended regional strategy: Asian Stem Nodes may serve DERP in a later data-plane phase, mainland nodes without public network access use TCP interconnect in a later data-plane phase, and Asian Stem Nodes connect to Core over TCP in a later data-plane phase.

Real DERP relay, TCP interconnect, UDP path switching, Headscale integration, endpoint management, relay assignment, active probing, and automatic path selection are not accepted as Phase 13 scope.

## Consequences

Regional behavior is explicit and auditable before it affects runtime transport. M-Net CN remains optional, per-network, and controlled by M-Policy.

The accepted Phase 13 shape creates a migration path to future data-plane behavior without misleading operators into thinking transport has changed. `m-net-cn@0.1.0` must therefore expose `controlPlaneOnly: true` or equivalent contract metadata until real network behavior is implemented by a later accepted phase.

## Revisit When

Revisit after concrete regional connectivity testing or if M-Net CN introduces unacceptable operational risk.
