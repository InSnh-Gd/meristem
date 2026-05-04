# Wasm3 Latest Reference

> Last checked: 2026-05-04. This is a concise project reference, not a copy of upstream docs.

---

## 1. Current Upstream Snapshot

- Latest GitHub release checked: `v0.5.0`, published 2021-06-02.
- Official repository: https://github.com/wasm3/wasm3
- Official docs live in the repository `docs/` directory.
- The repository README currently states that Wasm3 is in minimal maintenance mode.

Use Wasm3 only as an optional future runtime boundary for Meristem. It is not part of the MVP.

---

## 2. What Wasm3 Is

Wasm3 is a portable WebAssembly interpreter designed for small runtime size, low memory use, startup latency, portability, and environments where JIT is impractical or unavailable.

Relevant upstream properties:

- WebAssembly interpreter, not JIT.
- Can run many WASI apps.
- Intended for broad architectures and constrained systems.
- Useful system requirements are documented as small enough for embedded contexts.
- Supports C/C++ use directly and has ecosystem bindings/wrappers for languages including Python, Rust, Go, Zig, and others.

---

## 3. Meristem Usage

Use Wasm3 only when a future M-Extension or node capability needs:

- strong isolation for small extensions.
- portable execution on constrained nodes.
- no runtime code generation / no JIT.
- low startup overhead.
- deterministic, sandboxed plugin-style execution.

Do not use Wasm3 for:

- MVP Core.
- default service runtime.
- high-throughput server-side hot paths without benchmarking.
- replacing TypeScript-first service implementation.
- bypassing M-Policy, M-Log, or service definitions.

---

## 4. Integration Checklist

Before adopting Wasm3 in Meristem:

1. Write an ADR for the specific use case.
2. Define the M-Extension manifest and permission scope.
3. Define WASI access policy.
4. Define memory and gas/fuel limits.
5. Define logging and audit behavior.
6. Define failure isolation.
7. Benchmark against a TypeScript service or native implementation.

---

## 5. Sources

- Wasm3 repository: https://github.com/wasm3/wasm3
- Wasm3 latest release `v0.5.0`: https://github.com/wasm3/wasm3/releases/tag/v0.5.0
- Wasm3 installation docs: https://github.com/wasm3/wasm3/blob/main/docs/Installation.md
- Wasm3 cookbook: https://github.com/wasm3/wasm3/blob/main/docs/Cookbook.md
- Wasm3 troubleshooting: https://github.com/wasm3/wasm3/blob/main/docs/Troubleshooting.md
