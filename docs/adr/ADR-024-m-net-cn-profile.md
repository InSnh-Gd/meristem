# ADR-024: M-Net CN Regional Profile

## Status

Accepted (Phase 13 control-plane scope only)

## Context

Some network environments require regional routing and fallback behavior that the default M-Net strategy may not satisfy.

## Decision

Define M-Net CN as the first Regional Network Profile. Asian Stem Nodes may serve DERP. Mainland nodes without public network access use TCP interconnect. Asian Stem Nodes connect to Core over TCP.

Phase 13 accepts this ADR for **control-plane Regional Profile lifecycle only**: profile definitions, per-network profile state, profile transitions, suspended enable operations, and Phase 12 approval integration. Real data-plane behavior — DERP relay, TCP tunnels, UDP path switching, Headscale control, active probing, latency measurement, endpoint URL management, TLS private material, STUN/TURN credentials, route tables, and relay assignments — is explicitly deferred.

## Consequences

- Regional behavior intent is explicit and auditable through profile state, transitions, events, Timeline, and Audit Log.
- M-Net CN remains a per-network optional profile controlled by M-Policy (enable via Phase 12 approval; disable via M-Policy allow + Audit).
- `m-net-cn@0.1.0` is marked `controlPlaneOnly: true` and contains no real endpoint, secret, route, or probe data.
- Network transport paths are NOT changed by enabling `m-net-cn@0.1.0`.
- The profile contract stays compatible with future Config Lifecycle validate / publish / apply / ack / rollback semantics.

## Revisit When

- Before implementing any real data-plane network behavior (DERP relay, TCP/UDP interconnect, Headscale, probes).
- After concrete regional connectivity testing or if M-Net CN introduces unacceptable operational risk.
