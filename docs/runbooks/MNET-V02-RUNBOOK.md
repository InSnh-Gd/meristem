# M-Net v0.2 Runtime Runbook

> Real runtime failure modes, recovery paths, and diagnostic commands for
> the M-Net v0.2 NetBird-based data-plane track (ADR-N04).
>
> This document replaces the v0.2 scaffold runbook. Every documented path
> is backed by an automated failure-mode test or an explicit documented gap.

---

## 1. Runtime Architecture

```
Operator → M-UI BFF → Core → M-Net (control-plane)
                                  ↓
                            Node-Agent (host-local)
                                  ↓
                         NetBird Client (sidecar)
                                  ↓
                     NetBird Signal / Relay / STUN (infra)
```

M-Net owns the control-plane: profiles, network maps, ACL renders, relay assignments.
Node-agent owns host-local sidecar lifecycle and network-map enforcement.
NetBird client (sidecar) handles WireGuard, peer connections, and NAT traversal.
NetBird Management (Dashboard, ACL, auth) is excluded per ADR-N04.

---

## 2. Runtime Failure Matrix

### 2.1 OIDC Unavailable

**Trigger:** Keycloak discovery endpoint unreachable, JWKS fetch fails, or OIDC
provider returns non-200.

**Behavior:**
- `createSharedAuthVerifier` readiness check fails with `invalid_discovery`.
- Core returns `503` for protected routes when auth verifier is not ready.
- No fallback to local-dev JWT when OIDC mode is selected.

**Runtime code:** `invalid_discovery` (OidcDiscoveryFailure)

**Recovery:**
1. Verify Keycloak is running: `curl https://keycloak.example.com/realms/meristem/.well-known/openid-configuration`
2. Check Core network connectivity to Keycloak.
3. Core readiness probe heals automatically on next discovery attempt (no restart needed).

**Test:** `tests/failure-modes/auth-shared-verifier.failure-mode.test.ts`

---

### 2.2 Invalid Token

**Trigger:** Token with wrong issuer, wrong audience, unsupported algorithm,
missing required claims, expired, bad signature, or revoked.

**Behavior:**
- `SharedAuthVerifier.verify()` returns typed OidcAuthFailure.
  - `bad_issuer`: token issuer does not match configured issuer.
  - `bad_audience`: token audience not in configured audiences.
  - `unsupported_algorithm`: token algorithm not in allowed list.
  - `expired_token`: token `exp` is in the past (with clock tolerance).
  - `missing_claim`: required claim (sub, groups) absent.
  - `invalid_token`: token is malformed or signature invalid.
  - `revoked_token`: token state check returns `revoked`.

**Runtime code:** `bad_issuer | bad_audience | unsupported_algorithm | expired_token | missing_claim | invalid_token | revoked_token`

**Recovery:**
1. Obtain a fresh token from Keycloak.
2. Verify the Keycloak client configuration matches Core's audience/issuer config.
3. No Core restart needed.

**Test:** `tests/failure-modes/auth-shared-verifier.failure-mode.test.ts`, `tests/contracts/auth-shared-verifier.contract.test.ts`

---

### 2.3 SecretProvider Missing

**Trigger:** A credential ref (OIDC client secret, NetBird setup key, NetBird
infra credential) resolves to a provider/keyPath that returns no secret.

**Behavior at Core startup:**
- `resolveCoreOidcStartupSecrets()` detects missing secret.
- Core throws `CoreSecretStartupError` with `reason: 'secret_missing'`.
- Error payload is redacted: no plaintext secret value in the error.

**Behavior at node-agent runtime:**
- `resolveSecrets()` returns typed `secret_missing` failure.
- Node-agent enters degraded state with `secret.missing` reason.
- Sidecar is not started if required credential is missing.

**Runtime code:** `core.secret_startup_failed` (CoreSecretStartupError), `secret_missing` (SecretMissingFailure)

**Recovery:**
1. Check that the secret exists in the configured provider.
   - `local-dev-env`: verify the env var is set.
   - `vault-kv-v2`: check `vault kv get <mount>/<keyPath>`.
2. Verify the `secretBindings` in deployment config point to the correct provider/keyPath.
3. Restart the affected service.

**Test:** `tests/failure-modes/secret-provider.failure-mode.test.ts`, `tests/failure-modes/node-agent-sidecar-lifecycle.failure-mode.test.ts`

---

### 2.4 SecretProvider Denied

**Trigger:** The configured SecretProvider returns permission denied for a
credential ref (e.g., Vault policy denies read access).

**Behavior:**
- Core startup fails closed with `CoreSecretStartupError` (`reason: 'permission_denied'`).
- Error payload is redacted: no raw token or plaintext secret in `JSON.stringify()` output.
- Node-agent reports `secret.permission_denied` degraded reason.

**Runtime code:** `permission_denied` (SecretPermissionDeniedFailure), `core.secret_startup_failed`

**Recovery:**
1. Grant the Core / node-agent service account read access to the secret path.
2. Verify the Vault policy or local-dev-env mapping.
3. Restart the affected service.

**Test:** `tests/failure-modes/secret-provider.failure-mode.test.ts`

---

### 2.5 NetBird Client Missing

**Trigger:** The `netbird` binary is not found at the configured
`MERISTEM_NETBIRD_BINARY_PATH` or default PATH locations.

**Behavior:**
- `resolveLaunchConfig()` returns `netbird.binary.invalid` degraded reason.
- Node-agent enters degraded state without attempting process spawn.
- The `mnet-v02:sidecar-proof` command reports `prerequisite-missing`.

**Runtime code:** `netbird.binary.invalid` (degraded reason)

**Recovery:**
1. Install NetBird client: `apt install netbird` or Nix `netbird` package.
2. Verify: `which netbird && netbird version`.
3. Set `MERISTEM_NETBIRD_BINARY_PATH` if not on default PATH.
4. Restart the node-agent.

**Gap:**
Real binary-existence check (`stat`/`existsSync`) requires host-level access.
Automated CI does not have NetBird installed. The fail-closed behavior
(`netbird.binary.invalid` degraded reason) is tested in
`tests/failure-modes/runtime-failure-matrix.test.ts`.
The pre-deployment viability check is `bun run mnet:v02:sidecar-proof`.

**Test:** `tests/failure-modes/runtime-failure-matrix.test.ts`, `bun run mnet:v02:sidecar-proof`

---

### 2.6 NetBird Client Start Failure

**Trigger:** The NetBird client process fails to spawn: binary not executable,
permissions denied, missing config, or process exits immediately.

**Behavior:**
- `spawnNetBirdProcess()` catches the spawn error.
- Returns `netbird.start_failed` degraded reason.
- Node-agent enters degraded `observedHealth`.
- Sidecar process state remains at previous applied config (no mutation).

**Runtime code:** `netbird.start_failed` (degraded reason)

**Recovery:**
1. Check binary permissions: `ls -la $(which netbird)`.
2. Verify NetBird config exists: `cat /etc/netbird/config.json`.
3. Check system logs: `journalctl -u meristem-node-agent -n 50`.
4. Manually test: `netbird up` and verify it stays running.
5. Restart node-agent after fixing.

**Gap:**
Process spawn requires OS-level subprocess management. The typed failure path
(`netbird.start_failed`) is tested in `tests/failure-modes/runtime-failure-matrix.test.ts`.
Real `netbird up` behavior requires a live NetBird installation.

**Test:** `tests/failure-modes/runtime-failure-matrix.test.ts`

---

### 2.7 NetBird Client Probe Failure

**Trigger:** The running NetBird client process fails the health probe:
- Process is not running (`netbird.process.not_running`).
- `netbird status` returns non-Connected output (`probe.not_connected`).
- Health endpoint times out (`probe.timeout`).

**Behavior:**
- `probeNetBirdProcess()` returns typed `netbird.<reason>` degraded reason.
- Node-agent `observedHealth` set to `degraded`.
- Sidecar state reports unhealthy with specific finding.

**Runtime code:** `netbird.process.not_running | netbird.probe.not_connected | netbird.probe.timeout` (degraded reason)

**Recovery:**
1. Check process: `netbird status`.
2. Verify Signal connectivity: `curl <NETBIRD_SIGNAL_URL>/health`.
3. Verify STUN/Relay: `curl <NETBIRD_STUN_URL>/health`.
4. Restart the sidecar: `systemctl restart netbird` or node-agent restart.

**Test:** `tests/failure-modes/node-agent-sidecar.test.ts`, `tests/failure-modes/runtime-failure-matrix.test.ts`

---

### 2.8 Packet Reachability Failure

**Trigger:** Nodes cannot reach each other over the overlay network. Relay
endpoint unreachable and no direct path exists between peers.

**Behavior:**
- `resolveRelayAvailability()` checks relay reachability and direct path availability.
- If relay down but direct path exists: `direct_fallback` (drops relay, keeps direct).
- If relay down and no direct path: `fail_closed` with `relay.unavailable`.
- Existing established tunnels are preserved; only new path decisions fail.
- Operational read model reports degraded adapter state.

**Runtime code:** `relay.unavailable → direct_fallback | fail_closed`

**Recovery:**
1. Verify relay reachability: `curl <wstunnel_relay>/health` or `netbird status`.
2. Verify STUN/Relay infrastructure is running (managed by NixOS/systemd).
3. Check firewall rules allow UDP on WireGuard port and wstunnel/NetBird ports.
4. Node-agent re-establishes tunnels on next signed network-map pull.

**Test:** `tests/failure-modes/mnet-dataplane-security-hardening.test.ts`

---

### 2.9 Expired Map

**Trigger:** The signed network map has been stale longer than
`MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS` (default 900000 ms / 15 minutes).

**Behavior:**
1. Map older than server time + `staleTtlMs`: status moves to `stale`.
2. Map past `expiresAt`: status moves to `fail_closed`.
3. In `fail_closed`: all Meristem-managed WireGuard tunnels are torn down.
4. Partition reason: `network_map.stale` → `network_map.expired`.
5. Known peers and allowed peers are preserved from prior state.

**Runtime code:** `network_map.stale` → `network_map.expired` (partition states)

**Recovery:**
1. Restore M-Net control-plane connectivity between node-agent and M-Net join ingress.
2. Node-agent automatically pulls fresh signed map on next heartbeat/session cycle.
3. Tunnels are re-applied from the fresh map.
4. If M-Net is down, restore M-Net first, then node-agent auto-recovers.

**Test:** `tests/failure-modes/mnet-dataplane-security-hardening.test.ts`

---

### 2.10 M-UI Disabled Repair State

**Trigger:** Viewer or unauthorized actor checks command eligibility for a
high-risk action (break-glass, profile enable, migration apply, node disable).

**Behavior:**
- BFF eligibility endpoint returns `state: 'disabled'` with `disabledReason`
  containing a Chinese localized permission reason (e.g., `缺少权限：node:register`).
- No upstream mutation is called (mutation requests are blocked at the BFF layer).
- Confirmation-required actions without the confirmation field return 400
  `command.invalid_body` before reaching upstream.
- Upstream errors are mapped to typed error envelopes
  (e.g., `feature.unavailable` for 503, Core errors passed through).

**Runtime code:** `disabled` (eligibility state), `command.invalid_body` (missing confirmation), `feature.unavailable` (upstream error)

**Recovery:**
1. Actor obtains appropriate permission (operator / admin / security-admin).
2. For confirmation-required actions, include the `confirmation` field in the request body.
3. For upstream failures, the error envelope includes the actionable code.

**Test:** `tests/failure-modes/m-ui-bff-mnet-commands.test.ts`

---

## 3. Diagnostic Commands

### Pre-Deployment Checks
```bash
# NetBird sidecar viability proof (exit 0 with JSON report)
bun run mnet:v02:sidecar-proof

# Keycloak OIDC discovery check
curl https://keycloak.example.com/realms/meristem/.well-known/openid-configuration

# SecretProvider health (Vault)
vault status
vault kv get secret/meristem/netbird/setup-key
```

### Runtime Diagnostics
```bash
# Node-agent status (heartbeat health)
curl http://localhost:9090/health

# WireGuard interface status
wg show meristem-wg0

# NetBird client status
netbird status
```

### Automated Gates
```bash
# Full failure-mode suite (includes all documented classes)
bun run test:failure-modes

# Runtime failure matrix generation
bun test tests/failure-modes/runtime-failure-matrix.test.ts

# Agent pre-submit drift guard
bun run test:agent-submit
```

---

## 4. Incomplete / Deferred

| Item | Status | Reason |
|------|--------|--------|
| Real NetBird binary existence in CI | Deferred | NetBird client not available in CI environment; proof script validates pre-deployment |
| Real NetBird process spawn in automated tests | Deferred | OS-level subprocess management requires live NetBird installation |
| NetBird peer-to-peer packet probe in automated tests | Deferred | Requires three-host topology with real NetBird; covered by `bun run mnet:v02:live-proof` |
| Automatic node-agent token refresh after rotation | Deferred | Operators must restart/reconfigure node-agent after token rotation; see `docs/services/node-agent.md §3` |

---

## 5. Evidence

- Runtime failure matrix: generated by `bun test tests/failure-modes/runtime-failure-matrix.test.ts` → `tests/evidence/runtime-failure-matrix.json`
- Full failure-mode suite: `bun run test:failure-modes`
- Live proof harness: `bun run mnet:v02:live-proof`
- Sidecar viability proof: `bun run mnet:v02:sidecar-proof`
