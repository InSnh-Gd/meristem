/**
 * Task 10: Node Agent Service Definition — Contract Tests
 *
 * Validates that docs/services/node-agent.md contains every required service-definition
 * section and all node-agent config keys are documented in the service definition
 * and operational docs.
 *
 * Contract:
 * - All required service-definition headings exist in node-agent.md.
 * - No placeholder text remains (no "TODO", "TBD", "FIXME", empty table cells).
 * - All node-agent config keys are referenced in the service definition.
 * - All node-agent config keys are referenced in the runbook.
 */

import { beforeAll, describe, expect, it } from 'bun:test'

const SERVICE_DOC_PATH = 'docs/services/node-agent.md'
const RUNBOOK_PATH = 'docs/operations/RUNBOOK.md'

// ── Required heading patterns ─────────────────────────────────────────────

const REQUIRED_HEADINGS: { section: string; pattern: RegExp }[] = [
  { section: 'Identity', pattern: /^##\s+1\.\s+Identity/m },
  { section: 'Responsibility', pattern: /^##\s+2\.\s+Responsibility/m },
  { section: 'Contracts', pattern: /^##\s+3\.\s+Contracts/m },
  { section: 'Permissions', pattern: /^##\s+4\.\s+Permissions/m },
  { section: 'Dependencies', pattern: /^##\s+5\.\s+Dependencies/m },
  { section: 'Configuration', pattern: /^##\s+6\.\s+Configuration/m },
  { section: 'ACME Trust', pattern: /^##\s+7\.\s+ACME\s+Trust/m },
  { section: 'WireGuard Tooling Checks', pattern: /^##\s+8\.\s+WireGuard\s+Tooling\s+Checks/m },
  { section: 'Sidecar Boundary', pattern: /^##\s+9\.\s+Sidecar\s+Boundary/m },
  { section: 'Health', pattern: /^##\s+10\.\s+Health/m },
  { section: 'Lifecycle', pattern: /^##\s+11\.\s+Lifecycle/m },
  { section: 'Degraded Modes', pattern: /^##\s+12\.\s+Degraded\s+Modes/m },
  { section: 'Rollback', pattern: /^##\s+13\.\s+Rollback/m },
  { section: 'Logs', pattern: /^##\s+14\.\s+Logs/m },
  { section: 'Audit Facts', pattern: /^##\s+15\.\s+Audit\s+Facts/m },
  { section: 'Policy Requirements', pattern: /^##\s+16\.\s+Policy\s+Requirements/m },
  { section: 'Done Criteria', pattern: /^##\s+17\.\s+Done\s+Criteria/m }
]

// ── Required config keys ──────────────────────────────────────────────────

const REQUIRED_CONFIG_KEYS = [
  'MERISTEM_JOIN_URL',
  'MERISTEM_JOIN_TICKET',
  'MERISTEM_NODE_ID',
  'MERISTEM_NODE_TOKEN',
  'MERISTEM_AGENT_HEARTBEAT_INTERVAL_MS',
  'MERISTEM_AGENT_VERSION',
  'MERISTEM_MNET_CONTROL_URL',
  'MERISTEM_MNET_NETWORK_MAP_STALE_TTL_MS',
  'MERISTEM_WG_BINARY_PATH',
  'MERISTEM_WSTUNNEL_BINARY_PATH',
  'MERISTEM_ACME_DIRECTORY',
  'MERISTEM_ACME_ACCOUNT_KEY',
  'MERISTEM_HOST_PRIVATE_KEY_PATH',
  'MERISTEM_RELAY_ENDPOINT',
  'MERISTEM_LOG_LEVEL'
]

// ── Placeholder patterns ──────────────────────────────────────────────────

const PLACEHOLDER_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'TODO', pattern: /\bTODO\b/i },
  { name: 'TBD', pattern: /\bTBD\b/i },
  { name: 'FIXME', pattern: /\bFIXME\b/i }
]

// ── Empty table cell pattern (pipe-space-pipe, no content) ────────────────

const EMPTY_TABLE_CELL_PATTERN = /\| \|/

// ── Helpers ───────────────────────────────────────────────────────────────

async function readDoc(path: string): Promise<string> {
  return Bun.file(path).text()
}

// ── Heading coverage ──────────────────────────────────────────────────────

describe('Node-agent service definition heading coverage', () => {
  let documentText: string

  beforeAll(async () => {
    documentText = await readDoc(SERVICE_DOC_PATH)
  })

  for (const { section, pattern } of REQUIRED_HEADINGS) {
    it(`contains section "${section}" (## N. ${section.replace(/^\d+\.\s+/, '')})`, () => {
      expect(pattern.test(documentText), `Missing required section heading: ## ${section}`).toBe(
        true
      )
    })
  }
})

// ── Placeholder / empty cell checks ───────────────────────────────────────

describe('Node-agent service definition has no placeholder text', () => {
  let documentText: string

  beforeAll(async () => {
    documentText = await readDoc(SERVICE_DOC_PATH)
  })

  for (const { name, pattern } of PLACEHOLDER_PATTERNS) {
    it(`contains no "${name}" placeholder`, () => {
      expect(pattern.test(documentText), `Found "${name}" placeholder in ${SERVICE_DOC_PATH}`).toBe(
        false
      )
    })
  }

  it('contains no empty table cells (|  |)', () => {
    expect(
      EMPTY_TABLE_CELL_PATTERN.test(documentText),
      `Found empty table cells (|  |) in ${SERVICE_DOC_PATH}`
    ).toBe(false)
  })
})

// ── Config key documentation coverage ─────────────────────────────────────

describe('Node-agent config keys are documented in service definition', () => {
  let documentText: string

  beforeAll(async () => {
    documentText = await readDoc(SERVICE_DOC_PATH)
  })

  for (const key of REQUIRED_CONFIG_KEYS) {
    it(`documents config key \`${key}\``, () => {
      expect(
        documentText.includes(key),
        `Config key \`${key}\` is not documented in ${SERVICE_DOC_PATH}`
      ).toBe(true)
    })
  }

  it('documents at least 15 config keys in the configuration table', () => {
    const keyMatches = [...documentText.matchAll(/`(MERISTEM_[A-Z_]+)`/g)]
    expect(
      keyMatches.length,
      `Expected at least 15 MERISTEM_ config key references, found ${keyMatches.length}`
    ).toBeGreaterThanOrEqual(15)
  })
})

describe('Node-agent config keys are documented in runbook', () => {
  let runbookText: string

  beforeAll(async () => {
    runbookText = await readDoc(RUNBOOK_PATH)
  })

  for (const key of REQUIRED_CONFIG_KEYS) {
    it(`runbook references \`${key}\``, () => {
      expect(
        runbookText.includes(key),
        `Config key \`${key}\` is not referenced in ${RUNBOOK_PATH}`
      ).toBe(true)
    })
  }
})

// ── Service definition identity fields ────────────────────────────────────

describe('Node-agent service definition identity', () => {
  let documentText: string

  beforeAll(async () => {
    documentText = await readDoc(SERVICE_DOC_PATH)
  })

  it('declares service name as `node-agent`', () => {
    expect(documentText).toMatch(/name\s+\|\s+`node-agent`/)
  })

  it('declares version', () => {
    expect(documentText).toMatch(/version\s+\|\s+`0\.\d+\.\d+`/)
  })

  it('declares domain as `m-net`', () => {
    expect(documentText).toMatch(/domain\s+\|\s+`m-net`/)
  })

  it('declares kind as `node`', () => {
    expect(documentText).toMatch(/kind\s+\|\s+`node`/)
  })

  it('declares owner', () => {
    expect(documentText).toMatch(/owner\s+\|\s+Meristem/)
  })
})

// ── Key contract and frame references ─────────────────────────────────────

describe('Node-agent service definition key contracts', () => {
  let documentText: string

  beforeAll(async () => {
    documentText = await readDoc(SERVICE_DOC_PATH)
  })

  it('references join.redeem frame', () => {
    expect(documentText).toMatch(/join\.redeem/)
  })

  it('references session.resume frame', () => {
    expect(documentText).toMatch(/session\.resume/)
  })

  it('references heartbeat frame', () => {
    expect(documentText).toMatch(/heartbeat/)
  })

  it('references task.result frame', () => {
    expect(documentText).toMatch(/task\.result/)
  })

  it('references log.forward frame', () => {
    expect(documentText).toMatch(/log\.forward/)
  })

  it('references network-map pull', () => {
    expect(documentText).toMatch(/network.?map/i)
  })

  it('references WireGuard', () => {
    expect(documentText).toMatch(/WireGuard/)
  })

  it('references wstunnel', () => {
    expect(documentText).toMatch(/wstunnel/)
  })

  it('references ACME', () => {
    expect(documentText).toMatch(/ACME/)
  })

  it('references systemd', () => {
    expect(documentText).toMatch(/systemd/)
  })
})

// ── Degraded modes coverage ───────────────────────────────────────────────

describe('Node-agent service definition degraded modes', () => {
  let documentText: string

  beforeAll(async () => {
    documentText = await readDoc(SERVICE_DOC_PATH)
  })

  it('documents stale-map fail-closed behavior', () => {
    expect(documentText).toMatch(/stale.?map/i)
    expect(documentText).toMatch(/fail.?closed/i)
  })

  it('documents relay-only degraded mode', () => {
    expect(documentText).toMatch(/relay.?only/i)
  })

  it('documents partition state', () => {
    expect(documentText).toMatch(/partition/i)
  })
})
