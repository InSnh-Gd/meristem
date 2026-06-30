# ADR-U02: Plugin UI Sandbox And Security Model

## Status

Proposed — ADR / security / contract track only. This ADR does **not** authorize
runtime plugin UI implementation, dynamic component registration, service- or
plugin-supplied Svelte modules, BFF route changes, manifest acceptance changes,
new dependencies, or runtime artifact distribution.

Implementation remains blocked until the gates in [Implementation Blockers](#implementation-blockers)
are accepted.

## Context

The current M-UI surface is the M-UI Transitional Workbench. M-UI owns Svelte
routes, components, layout, interaction flow, and the `layout / modules / ui`
split. The M-UI BFF adapts facts into UI-facing display data and display-only
command eligibility. Capability domain services own facts, capabilities, events, policy state,
audit state, and domain state.

ADR-F02 positions M-Extension as a supplemental, low-permission control plane,
not a plugin-first application platform. M-Extension currently owns extension
definition / instance lifecycle and manifest validation only. It must not become
an arbitrary UI execution surface, runtime module loader, marketplace, permission
namespace owner, or replacement for first-class capability domain services.

ADR-U01 keeps SDUI v0.2 as the implemented route/component registry and defines
SDUI v0.3 runtime rendering as a proposed migration path only. ADR-U01 also
explicitly forbids service- or plugin-supplied UI in the v0.3 runtime renderer
track. Plugin UI therefore needs a separate ADR / security / contract track
before any implementation work can begin.

This ADR covers future **plugin-supplied UI contribution**. It does not cover
M-UI-owned extension management screens such as extension lists, details,
registration, enable, or disable flows. Those remain ordinary M-UI / BFF work
and must continue to follow the M-UI ownership rules.

## Decision

Keep plugin UI unimplemented and deferred. If Meristem later accepts plugin UI,
the default architecture is a sandboxed iframe contribution model:

1. M-UI renders only an M-UI-owned container / slot.
2. The plugin UI document runs inside an iframe sandbox **without
   `allow-same-origin`**.
3. The child frame receives redacted display data and capability results only via
   a versioned `postMessage` / `MessageChannel` protocol.
4. The child frame never receives Meristem bearer tokens, internal service URLs,
   Core routes, M-Policy routes, M-Log routes, or raw authoritative facts.
5. Command execution requests are display intents only. M-UI routes them through
   CommandWell and the BFF. Final authorization remains in Core / M-Policy, and
   audit facts remain in M-Log / Audit Log.
6. Unknown contracts, unsigned artifacts, invalid provenance, denied
   permissions, unavailable policy / audit, malformed messages, timeout, crash,
   or sandbox violation fail closed before rendering or execution.

Double-iframe isolation and Wasm-based UI execution may be considered later as
hardening alternatives, but they are not the default recommendation. They require
a separate cost / threat review because they add operational complexity without
removing the need for SDUI, BFF, policy, audit, signing, and fail-closed gates.

## Non-Goals

- No runtime plugin UI implementation in the current codebase.
- No dynamic Svelte / JavaScript / CSS module imports from extensions.
- No plugin-provided M-UI pages, layouts, components, stores, charts, motions, or
  primitive wrappers.
- No extension-defined permissions or permission namespace registration.
- No marketplace install / update / uninstall flow.
- No Core, BFF, or service route changes to accept plugin UI manifests.
- No plugin iframe direct access to Core, capability domain services, internal routes, or
  browser credentials.

## Ownership Boundaries

| Boundary | Owner | Rule |
|----------|-------|------|
| Extension definition / instance lifecycle | M-Extension | Control-plane catalog only; current manifests reject runtime UI fields. |
| Workbench routes, containers, slots, and fallback UI | M-UI | M-UI owns visible structure and must render a degraded state when plugin UI is blocked. |
| Display data adaptation | M-UI BFF | BFF returns minimal, redacted, schema-decoded display projections only. |
| Final facts | Owning capability domain service | Plugin UI never becomes an authoritative fact source. |
| Final authorization | Core / M-Policy | UI eligibility remains display-only. |
| Audit facts | M-Log / Audit Log | Plugin code cannot write or suppress Audit facts. |
| SDUI placement contract | M-UI / contracts | Plugin slots require a future versioned SDUI extension after ADR-U01 acceptance. |

M-Extension may later catalog plugin UI contribution metadata only after a new
manifest version is accepted. It must not execute UI, serve mutable unverified
artifacts, inject frontend modules into M-UI, or own final UI composition.

## Implementation Blockers

Plugin UI implementation may not begin until all of the following are true:

1. ADR-U01 or a successor SDUI runtime ADR is accepted and includes an extension
   point for sandbox slots.
2. This ADR or a successor is accepted after a security review.
3. Contract versioning is defined for SDUI plugin slots, M-Extension manifest UI
   declarations, BFF display data, `postMessage` protocol messages, signing /
   provenance metadata, rollout, rollback, and compatibility windows.
4. Current M-Extension control-plane manifests continue to reject plugin UI fields
   until the new manifest version is explicitly introduced.
5. M-Policy and Audit Log behavior is specified for install, enable, update,
   disable, command request, denied command request, sandbox kill, and artifact
   revocation.
6. Security, failure-mode, contract, UI-contract, and migration tests exist and
   pass for both old and new contracts.
7. Operations documentation defines artifact revocation, signer revocation,
   sandbox outage, repeated crash disablement, and rollback to no plugin UI.

## Threat Model

Assume these attacker capabilities:

- A malicious extension publisher submits a package with hostile UI code.
- A trusted publisher account or package repository is compromised.
- A previously valid plugin UI artifact is replayed, downgraded, or replaced.
- A hostile operator with extension permissions tries to install or enable an
  over-broad UI contribution.
- Plugin UI JavaScript attempts XSS, phishing, clickjacking, command spoofing,
  `postMessage` replay, message flooding, oversized payloads, or focus trapping.
- Plugin UI attempts data exfiltration through network requests, images, fonts,
  forms, storage, cookies, referrers, URLs, console logs, or timing channels.
- Plugin UI crashes, hangs, uses excessive CPU, or repeatedly reloads.
- A compromised service or BFF path tries to publish malformed SDUI/plugin slot
  metadata.
- A colluding extension tries to bypass CommandWell by sending arbitrary execute
  URLs or internal service route names.

Fail-closed abuse paths:

| Abuse path | Required fail-closed behavior |
|------------|-------------------------------|
| Unsigned, untrusted, revoked, or digest-mismatched artifact | Do not serve or render the iframe; show degraded state; write Full Log and Audit when tied to an enable/update attempt. |
| Plugin UI field appears in a current v0.1 manifest | Reject manifest decode; no partial registration. |
| Unknown slot, component, page, action, permission, or capability | Reject SDUI / manifest decode before render. |
| Child sends unknown, oversized, replayed, out-of-order, or nonce-mismatched message | Drop message, terminate iframe for the contribution, write Full Log, and do not call BFF/Core. |
| Child requests arbitrary URL, internal route, raw token, or undeclared data | Deny request and terminate the contribution if repeated. |
| Child requests command execution | Route only by known action ID through CommandWell and BFF; no inline execution. |
| M-Policy or Audit Log unavailable for required action | Disable or fail the command before mutation. |
| Sandbox boot, render, or heartbeat timeout | Destroy iframe, display degraded state, and apply crash budget. |
| Repeated crashes or policy denials | Disable the contribution or instance until an operator reviews it. |
| Plugin attempts hidden destructive UI or misleading labels | Container displays Meristem-owned target, risk, policy, audit, and confirmation context outside the iframe. |

## Sandbox Model

Default sandbox attributes:

```text
sandbox="allow-scripts"
```

The default explicitly omits:

- `allow-same-origin`
- `allow-top-navigation`
- `allow-top-navigation-by-user-activation`
- `allow-popups`
- `allow-popups-to-escape-sandbox`
- `allow-downloads`
- `allow-forms`
- `allow-modals`
- `allow-pointer-lock`
- `allow-presentation`

Additional allowances require a new security review and per-contribution contract
justification. The iframe gets an opaque origin. It must not access parent DOM,
cookies, local storage, session storage, IndexedDB, service workers, Meristem
tokens, or same-origin BFF credentials.

The parent must own lifecycle: create, boot, heartbeat, resize, visibility,
shutdown, crash budget, timeout budget, and degraded-state rendering. Route
navigation or actor changes destroy the iframe and issue a new nonce if the slot
is recreated.

### Hardening Alternatives

- **Double iframe**: an outer Meristem-controlled wrapper can mediate the inner
  plugin document. This may reduce direct parent/child coupling but increases
  lifecycle and debugging complexity.
- **Wasm UI runtime**: a Wasm sandbox can constrain computation, but it does not
  by itself solve DOM rendering, accessibility, browser exfiltration, SDUI
  placement, signing, provenance, policy, audit, or BFF boundary concerns.

Neither alternative weakens the default requirement that plugin UI remains
isolated from M-UI internals and Meristem service credentials.

## CSP Model

M-UI parent CSP must not be broadened for plugin code. Plugin UI requires a
separate sandbox document policy.

Parent requirements:

- `script-src` continues to cover only M-UI-owned scripts.
- `frame-src` is restricted to the Meristem plugin UI sandbox origin or another
  explicitly versioned artifact gateway after signing / provenance gates exist.
- `connect-src` for M-UI remains limited to approved M-UI BFF endpoints; plugin
  UI must not add Core, capability domain service, or arbitrary external origins.
- `frame-ancestors` remains controlled by the normal M-UI deployment policy.

Plugin document requirements:

- `default-src 'none'`
- `script-src` restricted to the verified artifact digest / nonce / hash model.
- `style-src` restricted to the verified artifact; inline style requires an
  explicit nonce / hash rule.
- `connect-src 'none'` by default. Data arrives through the parent protocol, not
  plugin network fetches.
- `img-src` limited to approved `data:` / `blob:` or signed artifact assets only.
- `font-src`, `media-src`, `worker-src`, `child-src`, `object-src`, `form-action`,
  and `base-uri` default to `none` unless a later ADR accepts a narrower rule.
- `referrer-policy: no-referrer`.

If a plugin UI use case requires network egress, that is a separate security and
operations decision, not a default plugin UI capability.

## postMessage Protocol

The protocol must be versioned and schema-decoded at both ends. Use
`MessageChannel` when available so the parent can close the channel without
depending on global window message state.

Every message includes:

- `protocolVersion`
- `extensionId`
- `instanceId`
- `contributionId`
- `slotId`
- `sessionNonce`
- `sequence`
- `correlationId`
- `kind`
- `payloadSchemaVersion`
- `payload`

Parent-to-child messages are limited to boot, redacted render data, capability
result, visibility, degraded-state notification, and shutdown. Child-to-parent
messages are limited to ready, resize request, command intent, telemetry summary,
and error summary.

Rules:

- The parent validates `event.source` against the exact iframe window. If the
  child has a non-opaque origin in a future model, the parent also validates
  origin against an allowlist.
- The child validates the boot nonce before sending any request.
- Messages have size limits, sequence checks, replay protection, and timeout
  windows.
- Payloads are decoded by Effect Schema or an equivalent versioned contract.
- No message may contain bearer tokens, raw secrets, internal URLs, arbitrary
  execute URLs, SQL-like query strings, or unbounded `Record<string, unknown>`
  command payloads.

## Permission And Capability Schema

Future plugin UI declarations must reference existing Meristem permissions and a
closed UI capability enum. Plugins cannot create permissions or extend command
namespaces.

Minimum declaration fields for a future manifest version:

```ts
type PluginUiContributionDeclaration = {
  schemaVersion: "plugin-ui@0.1.0";
  contributionId: string;
  surface: "panel" | "route-slot";
  targetRouteId: string;
  targetSlotId: string;
  requiredPermissions: string[];
  capabilities: Array<"render:redacted-data" | "request:command-intent" | "emit:telemetry-summary">;
  riskClass: "low" | "medium" | "high" | "critical";
  artifactDigest: string;
  signerId: string;
};
```

Rules:

- `schemaVersion` is not accepted by the current M-Extension manifest.
- `surface` cannot replace M-UI route ownership. A route slot is an M-UI-owned
  container, not plugin page ownership.
- `requiredPermissions` must be known permissions and are checked for display
  eligibility only.
- `capabilities` is a closed enum; unknown capabilities fail decode.
- `high` and `critical` contributions require explicit M-Policy and Audit gates
  for enable/update and for any command intent they can emit.
- Disabled or ineligible contributions render an M-UI-owned Chinese disabled
  reason and do not create Audit facts merely by being hidden.

## Signing And Provenance

Plugin UI artifacts require supply-chain controls before they can be served:

- immutable artifact digest pinned in the accepted manifest instance;
- trusted signer identity and signer policy;
- package provenance statement with source repository, build workflow, build time,
  dependency lock digest, and SBOM reference;
- compatibility metadata for Meristem, M-UI, BFF, SDUI, and plugin protocol
  versions;
- revocation list for signer, package, version, digest, and instance;
- downgrade protection so an enabled instance cannot silently move to an older
  artifact;
- no mutable `latest` references in enabled instances;
- install/update/enable operations write Audit before activation when policy
  allows the change.

Development-only unsigned artifacts, if ever allowed, must require an explicit
local flag, must not be accepted in production mode, and must display an
M-UI-owned unsafe-development banner outside the iframe.

## Crash, Timeout, And Resource Isolation

Each contribution runs in its own iframe and failure budget. A failed contribution
must not take down M-UI, the BFF, Core, or other contributions.

Required controls:

- boot timeout;
- render-data acknowledgement timeout;
- heartbeat / liveness timeout;
- maximum message size;
- message rate limit;
- resize rate limit;
- crash counter per contribution and per instance;
- automatic teardown on route change, actor change, permission change, or policy
  state refresh;
- degraded inline state owned by M-UI;
- operator-visible disablement reason after repeated failures.

Browser CPU and memory isolation are imperfect. That is why plugin UI remains
blocked until operational controls, kill behavior, and failure-mode tests exist.

## Redaction, Logging, And Audit

Display data sent to plugin UI must already be redacted by the BFF and decoded by
the parent. Plugin UI never receives raw secret values, bearer tokens, raw
webhook tokens, internal route URLs, private service state, Audit Log raw bodies,
or LLM prompt material.

Logging rules:

- Timeline Log may record operator-visible plugin UI lifecycle milestones such as
  contribution enabled, disabled, degraded, or recovered.
- Full Log records validation failures, sandbox kills, CSP violations, protocol
  violations, crash budgets, and artifact verification failures.
- Audit Log records install/update/enable/disable decisions and command execution
  decisions when actor and resource are known.
- Logs include `extensionId`, `instanceId`, `contributionId`, `actor`, `action`,
  `policyDecisionId` when present, `riskClass`, `reason`, and `correlationId`.
- Logs must not include raw iframe DOM, full message payloads, secrets, artifact
  source contents, raw display projections, or plugin console output by default.

Plugin code cannot write Meristem logs directly. All logging is mediated by M-UI,
BFF, Core, M-Policy, M-Log, and the owning services.

## Component And Page Registration

Plugin UI does not register Svelte components or import frontend modules. Future
registration, if accepted, is data-only and slot-based:

1. A versioned SDUI extension declares an M-UI-owned route slot.
2. A versioned M-Extension manifest declares a signed contribution for that slot.
3. BFF exposes redacted display data for the slot through a versioned contract.
4. M-UI renders its own container and embeds the sandboxed iframe.
5. Unknown route IDs, slot IDs, contribution IDs, component kinds, or actions fail
   decode before render.

Page-level contributions are not accepted by default. A plugin may at most fill a
named slot in an M-UI-owned route. Any future dedicated extension route must still
be an M-UI-owned route shell with CommandWell, disabled reasons, state-source
visibility, and audit / policy evidence rendered outside the iframe.

## BFF Boundary

Plugin UI never calls Core or capability domain services directly. It also never calls BFF
directly because it has no Meristem credentials. The only path is:

```text
plugin iframe -> postMessage -> M-UI container -> M-UI BFF -> Core public facade -> owning capability domain service
```

Rules:

- BFF maps known contribution IDs to known display projections; no arbitrary data
  queries from plugin messages.
- BFF maps known command action IDs to Core public facades; no `/internal/v0/*`
  routes and no plugin callback URLs.
- BFF does not own final facts, final authorization, final policy decisions, or
  plugin UI component structure.
- M-UI displays target, permission, policy requirement, audit requirement,
  correlation ID, and result evidence outside the iframe for any command intent.

## Tests Required Before Any Implementation

Future implementation PRs must include at least:

- Contract tests proving current `m-extension-manifest@0.1.0` rejects plugin UI
  fields until a new version is introduced.
- Contract tests for SDUI plugin slot declarations, manifest UI declarations,
  BFF display projections, `postMessage` messages, signing metadata, and
  old/new compatibility.
- UI-contract tests for slot rendering, degraded states, unknown slot/action
  rejection, CommandWell handoff, visible Chinese disabled reasons, and no direct
  M-UI-to-Core or plugin-to-BFF calls.
- Failure-mode tests for unsigned artifact, revoked signer, digest mismatch,
  malformed message, replayed message, oversized message, policy unavailable,
  Audit unavailable, BFF unavailable, iframe timeout, and repeated crashes.
- Security tests or review evidence for CSP, sandbox attributes, no
  `allow-same-origin`, no token leakage, and no arbitrary network egress.
- Migration tests for rollback to no plugin UI and compatibility windows across
  M-Extension, M-UI, BFF, and contracts.

Focused implementation gates, once implementation is allowed:

```bash
bun run test:contracts
bun run test:ui-contract
bun run test:failure-modes
bun run typecheck
bun run typecheck:m-ui
```

## Acceptance Scenarios

Scenario: current baseline has no plugin UI runtime

Given current M-Extension manifest validation
When a manifest declares plugin UI fields
Then validation rejects the manifest
And M-UI renders no plugin-provided pages, components, layouts, or runtime
frontend modules

Scenario: unsigned plugin UI fails closed

Given a future accepted plugin UI track
And an extension contribution references an unsigned or digest-mismatched artifact
When the operator enables the instance
Then the artifact is not served
And the contribution is not rendered
And the failed enable/update path records the required policy and audit evidence

Scenario: malformed child message cannot execute a command

Given a future sandboxed plugin iframe
When the child sends an unknown, replayed, nonce-mismatched, oversized, or
arbitrary-URL command message
Then M-UI drops the message or terminates the contribution
And no BFF, Core, M-Policy, or M-Log execution call is made

Scenario: valid high-risk command intent preserves Meristem boundaries

Given a future plugin UI contribution with permission to request a known high-risk
command intent
When the actor confirms the command in CommandWell
Then execution flows through BFF -> Core public facade -> M-Policy / owning
service / M-Log
And the UI displays policy and audit evidence outside the iframe

## Consequences

This ADR intentionally slows plugin UI. It preserves ADR-F02's anti-plugin-drift
boundary, keeps M-Extension as a control-plane catalog, and prevents SDUI runtime
rendering from becoming a back door for untrusted frontend execution.

The cost is additional future contract work: manifest versions, SDUI slot
versions, `postMessage` schemas, signing/provenance metadata, CSP configuration,
failure-mode tests, and operations runbooks. That cost is required because plugin
UI crosses browser, supply-chain, authorization, audit, and operator trust
boundaries at the same time.

## Revisit When

Reopen this ADR only when all of the following are true:

- A named operator workflow cannot be delivered as an M-UI-owned route plus BFF
  display contract.
- ADR-U01 or a successor SDUI runtime ADR has been accepted.
- M-Extension control-plane behavior is implemented, audited, and stable.
- A concrete plugin UI pilot has an owner, threat review, contract migration plan,
  rollback plan, and test matrix.
- The team explicitly accepts the supply-chain, sandbox, policy, audit, and
  operations burden of plugin-supplied UI.
