# Meristem v0.2 Release Notes

> Real runtime behavior for the v0.2 NetBird data-plane track (ADR-N04).
>
> This document replaces the scaffold v0.2 release notes. Every documented
> behavior is backed by automated failure-mode tests or explicit gaps.

---

## 1. Release Scope

v0.2 introduces the NetBird-based data-plane orchestration track:

- **M-Net control-plane:** profile lifecycle, network-map generation, relay
  assignment, ACL rendering, and node administrative state control
  (disable/isolate/recover/switch-role).

- **Node-agent host-local runtime:** NetBird sidecar lifecycle management,
  SecretProvider credential resolution, signed network-map enforcement with
  stale-map fail-closed, WireGuard interface configuration, and heartbeat/
  log-forward/task-execution session frames.

- **SecretProvider integration:** OIDC client secret, NetBird setup key,
  NetBird infra credentials, and sidecar credentials are resolved through
  the typed SecretProvider boundary at service startup and sidecar launch.

- **Shared auth verifier:** One package-level verifier selects exactly one
  auth mode from runtime deployment config. OIDC mode rejects local JWT.
  Local-dev mode requires explicit secret and is not a fallback for OIDC.

- **Three-host live proof:** `bun run mnet:v02:live-proof` composes deploy
  proof, requires Keycloak OIDC, enables `m-net@0.3.0`, joins two nodes,
  and requires packet reachability over the NetBird overlay before reporting
  release success.

---

## 2. Runtime Failure Behavior

### Authentication & Authorization

| Failure | Behavior | Recovery |
|---------|----------|----------|
| OIDC discovery unavailable | Core readiness fails; routes return 503 | Restore Keycloak; no restart needed |
| Invalid token (issuer/audience/signature/expired/revoked) | 401 with typed code | Obtain fresh token from Keycloak |
| Missing SecretProvider credential | Core startup fail-closed; node-agent degraded | Populate secret; restart service |
| Denied SecretProvider credential | Core startup fail-closed; redacted error | Grant access; restart service |

### NetBird Sidecar

| Failure | Behavior | Recovery |
|---------|----------|----------|
| NetBird binary missing | Node-agent degraded (netbird.binary.invalid) | Install binary; restart agent |
| NetBird process start failure | Node-agent degraded (netbird.start_failed) | Fix binary/config; restart |
| NetBird probe failure | Node-agent degraded (netbird.<reason>) | Restore infra connectivity |
| SecretProvider missing for sidecar | Sidecar not spawned (secret.missing) | Populate secret; cycle desired state |

### Data-Plane

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Packet reachability failure | Direct fallback or fail_closed (relay.unavailable) | Restore relay/STUN/Signal |
| Expired network map | Stale → fail_closed; tunnels torn down | Restore M-Net connectivity |
| Stale map (TTL exceeded) | Existing tunnels preserved; new paths blocked | Pull fresh map |
| Invalid map signature | fail_closed; prior peers preserved | Restore M-Net signing key |

### M-UI Command Layer

| Failure | Behavior | Recovery |
|---------|----------|----------|
| Viewer eligibility check | Disabled state with typed reason | Obtain permissions |
| Missing confirmation | 400 (command.invalid_body) | Include confirmation field |
| Upstream service unavailable | 503 typed error envelope | Restore upstream service |

---

## 3. Known Gaps and Limitations

| Gap | Reason | Mitigation |
|-----|--------|------------|
| Real NetBird binary not in CI | NetBird client not available in containerized CI | `bun run mnet:v02:sidecar-proof` validates pre-deployment |
| Real NetBird process spawn not tested | OS-level subprocess requires live binary | Typed failure paths tested via mock injection |
| Automatic token refresh after rotation | Not in v0.2 scope | Operators restart node-agent after rotation |
| NetBird Management integration | Excluded per ADR-N04 | Meristem renders config; NetBird infra is external |
| wstunnel fallback mode | Not in v0.2 (NetBird-only runtime) | Legacy path retained for migration window only |

---

## 4. Configuration

Key environment variables for production deployment:

```bash
# Core OIDC
MERISTEM_OIDC_ISSUER=https://keycloak.example.com/realms/meristem
MERISTEM_OIDC_AUDIENCES=meristem-core

# SecretProvider
MERISTEM_SECRET_PROVIDER_BACKEND=vault-kv-v2
MERISTEM_OIDC_CLIENT_SECRET=secret:runtime:keycloak/client-secret

# NetBird infrastructure (external, managed by NixOS/systemd)
MERISTEM_MNET_SIGNAL_URL=https://signal.example.com
MERISTEM_MNET_RELAY_URL=https://relay.example.com
MERISTEM_MNET_STUN_URL=stun:stun.example.com:3478

# Node-agent
MERISTEM_JOIN_URL=wss://control.example.com:8443/join/v0/session
MERISTEM_NETBIRD_BINARY_PATH=/run/current-system/sw/bin/netbird
MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS=900000
```

---

## 5. Verification Gates

```bash
# Pre-submit drift guard
bun run test:agent-submit

# Full failure-mode suite
bun run test:failure-modes

# Runtime failure matrix generation
bun test tests/failure-modes/runtime-failure-matrix.test.ts

# Sidecar viability proof (pre-deployment)
bun run mnet:v02:sidecar-proof

# Live three-host proof (requires real infrastructure)
bun run mnet:v02:live-proof
```

---

## 6. Evidence

- Runtime failure matrix: `tests/evidence/runtime-failure-matrix.json` (generated by `bun test tests/failure-modes/runtime-failure-matrix.test.ts`)
- Three-host overlay proof: `tests/evidence/mnet-overlay-client-proof.json`
- Sidecar viability proof: `bun run mnet:v02:sidecar-proof`
- Full runbook: `docs/runbooks/MNET-V02-RUNBOOK.md`
