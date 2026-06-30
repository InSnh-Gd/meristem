/**
 * v02-deploy-proof.ts — v0.2 deployment proof command.
 * Supports --target=nixos and --target=oci. Exits 0 with typed JSON output.
 */
import { existsSync } from "node:fs"
import { execSync } from "node:child_process"

const target = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1] || process.env.DEPLOY_TARGET || "nixos"
type PO = { status: "prerequisite-missing" | "success"; step: string; message?: string; detail?: string }
const results: PO[] = []
const mk = (s: string, m: string): PO => ({ status: "prerequisite-missing", step: s, message: m })
const ok = (s: string, d: string): PO => ({ status: "success", step: s, detail: d })

for (const e of [
  { n: "OIDC_ISSUER_URL", d: "OIDC issuer URL" },
  { n: "OIDC_CLIENT_ID", d: "OIDC client ID" },
  { n: "MERISTEM_MNET_SIGNAL_URL", d: "NetBird Signal endpoint" },
  { n: "MERISTEM_MNET_STUN_URL", d: "NetBird STUN endpoint" },
]) results.push(process.env[e.n] ? ok(`env:${e.n}`, `${e.d} set`) : mk(`env:${e.n}`, `${e.d} not set`))

if (target === "nixos") {
  for (const p of ["/etc/nixos/flake.nix", "/etc/nixos/configuration.nix", "/nix/var/nix/profiles/system"])
    results.push(existsSync(p) ? ok(`nixos:${p.replace(/[^a-zA-Z0-9]/g, "_")}`, `${p} exists`) : mk(`nixos:${p.replace(/[^a-zA-Z0-9]/g, "_")}`, `${p} not found`))
  try { const v = execSync("bun --version 2>/dev/null", { encoding: "utf8", timeout: 5000 }).trim(); results.push(ok("nixos:bun", `${v} available`)) }
  catch { results.push(mk("nixos:bun", "bun not found")) }
}
if (target === "oci") {
  for (const [bin, label] of [["podman", "Podman"], ["docker", "Docker"]] as const) {
    try { const v = execSync(`${bin} --version 2>/dev/null`, { encoding: "utf8", timeout: 5000 }).trim(); results.push(ok(`oci:${bin}`, `${v} available`)); break }
    catch { if (bin === "docker") results.push(mk("oci:runtime", "No podman or docker found")) }
  }
  try { execSync("podman-compose --version 2>/dev/null || docker-compose --version 2>/dev/null", { encoding: "utf8", timeout: 5000 }); results.push(ok("oci:compose", "Compose available")) }
  catch { results.push(mk("oci:compose", "No compose-compatible tooling")) }
}
try { const wv = execSync("wg --version 2>/dev/null", { encoding: "utf8", timeout: 5000 }).trim(); results.push(ok("node-agent:wg", `${wv}`)) }
catch { results.push(mk("node-agent:wg", "wg binary not found")) }

const allSuccess = results.every((r) => r.status === "success")
process.stdout.write(JSON.stringify({ proof: `v02-deploy-${target}`, target, results, verdict: allSuccess ? "pass" : "prerequisite-missing" }, null, 2) + "\n")
process.exit(0)
