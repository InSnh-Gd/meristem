# M-UI BFF Service Definition

> M-UI BFF is not part of the MVP implementation. This document records the boundary so CLI-first MVP work does not accidentally create UI coupling.

## 1. Identity

| Field | Value |
|-------|-------|
| name | `m-ui-bff` |
| version | `0.1.0` |
| domain | `m-ui` |
| kind | `bff` |

---

## 2. MVP Boundary

MVP excludes M-UI and M-UI BFF. No MVP requirement depends on SvelteKit or SDUI.

The BFF boundary remains reserved for later:

- node status aggregation
- Timeline display data
- policy decision panels
- config lifecycle views
- permission-aware UI commands

---

## 3. Future Rules

- BFF must use Eden where possible.
- BFF must be permission-aware.
- BFF must not bypass M-Policy.
- BFF must not construct Audit facts.
- BFF must serve SDUI schemas that comply with `docs/ui/SDUI-SCHEMA.md`.
