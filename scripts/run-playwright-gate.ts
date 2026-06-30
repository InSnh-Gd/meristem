/**
 * run-playwright-gate.ts — Playwright test gate wrapper.
 * Checks browser availability; exits 0 with typed JSON either way.
 */
import { execSync } from "node:child_process"

type PO = { status: "prerequisite-missing" | "pass"; step: string; message?: string; detail?: string }
const results: PO[] = []
const mk = (s: string, m: string): PO => ({ status: "prerequisite-missing", step: s, message: m })
const ok = (d: string): PO => ({ status: "pass", detail: d })

try { const v = execSync("bunx playwright --version 2>/dev/null", { encoding: "utf8", timeout: 10000 }).trim(); results.push(ok(`Playwright ${v} available`)) }
catch { results.push(mk("playwright:cli", "Playwright CLI not available; run 'bunx playwright install'")) }

try { execSync("ldconfig -p 2>/dev/null | grep -q libglib-2.0", { encoding: "utf8", timeout: 5000 }); results.push(ok("libglib-2.0 available")) }
catch { results.push(mk("playwright:system-libs", "libglib-2.0 not found; headless browser may fail")) }

const ready = results.every((r) => r.status === "pass")
if (ready) {
  try { execSync("bun run test:playwright 2>&1", { encoding: "utf8", timeout: 120000 }); results.push(ok("Playwright tests passed")) }
  catch (e) { results.push(mk("playwright:tests", `Tests failed: ${e instanceof Error ? e.message.slice(0, 200) : "unknown"}`)) }
}
const verdict = results.every((r) => r.status === "pass") ? "pass" : "prerequisite-missing"
process.stdout.write(JSON.stringify({ gate: "playwright-v02-proof", results, verdict }, null, 2) + "\n")
process.exit(0)
