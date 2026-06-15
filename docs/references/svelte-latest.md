# Svelte Latest Reference

> Last checked: 2026-05-22. This is a concise project reference, not a copy of upstream docs.  
> Context7 mirror: `/websites/svelte_dev` (benchmark 89.1).  
> Round query: 2026-05-22 via Context7 MCP (`resolve-library-id` + `query-docs`).

---

## 1. Current Upstream Snapshot

- Latest GitHub release checked: `svelte@5.37.0` (Context7 2026-05-22 query).
- Official docs: https://svelte.dev/docs/svelte/overview
- Official repository: https://github.com/sveltejs/svelte
- SvelteKit docs: https://svelte.dev/docs/kit
- Svelte 5 migration guide: https://svelte.dev/docs/svelte/v5-migration-guide

Svelte 5 is the current major line. It uses runes for explicit reactivity and remains compatible with gradual migration patterns from older Svelte code.

---

## 2. Core Concepts

- Svelte is a compiler-based UI framework.
- Svelte 5 uses explicit runes for reactivity.
- `$state` declares reactive state (deep proxy by default).
- `$state.raw(value)` declares non-proxied state for large data structures (e.g. API responses).
- `$derived` declares computed state.
- `$effect` performs side effects when dependencies change.
- `$props` reads component props; do not mutate props directly.
- Event handling: `on:event` (Svelte 4) replaced by `onEvent` (e.g. `onclick`).
- Snippets replace many slot-style composition patterns.

---

## 3. Minimal Svelte 5 Pattern

```svelte
<script lang="ts">
  let { label = 'Count' } = $props<{ label?: string }>()
  let count = $state(0)
  const doubled = $derived(count * 2)

  $effect(() => {
    console.debug('count changed', count)
  })
</script>

<button onclick={() => count += 1}>
  {label}: {count} / {doubled}
</button>
```

---

## 4. Class-Based State with Runes

Svelte 5 allows runes inside class instances. This is useful for shared stores outside `.svelte` files:

```ts
class AppState {
  token = $state('')
  loading = $state(false)

  get actor() {
    return this.token ? parseJwt(this.token).sub : null
  }
}

export const appState = new AppState()
```

## 5. Meristem Usage

M-UI is not part of the MVP, but future Svelte/SvelteKit work should follow:

- SvelteKit + SDUI for the operational interface.
- CLI remains the MVP entrypoint; UI should not become a hidden control plane.
- High-risk UI actions must route through CommandWell and M-Policy.
- Critical operational state must show traceable source IDs.
- Use Svelte 5 runes for new components.
- Use `$state.raw` for large API response objects to avoid proxy overhead.

---

## 6. Migration Notes

- Prefer `$state` over implicit top-level reactive `let` patterns for new code.
- Prefer `$derived` over `$:` derivations.
- Prefer `$effect` for side effects; avoid using it for pure computations.
- Read props through `$props`; do not mutate props directly.
- Replace `on:click` with `onclick` in templates.

## 7. Version Pinning Note

Svelte 5 is still evolving. Minor releases may adjust rune edge-case behavior.  
Pin `svelte`, `@sveltejs/kit`, and `@sveltejs/vite-plugin-svelte` to exact versions.

---

## 8. Sources

- Svelte official docs: https://svelte.dev/docs/svelte/overview
- Svelte official migration guide: https://svelte.dev/docs/svelte/v5-migration-guide
- Svelte latest release `svelte@5.37.0`: https://github.com/sveltejs/svelte/releases
- Context7 official-doc mirror: `/websites/svelte_dev` (benchmark 89.1)

## 9. Context7 Query Log (2026-05-22)

| Topic | Context7 libraryId | Key findings |
|-------|-------------------|--------------|
| Runes API | `/websites/svelte_dev` | `$state`, `$derived`, `$effect`, `$props` are core |
| `$state.raw` | `/websites/svelte_dev` | Non-proxied state for performance (large API responses) |
| Event syntax | `/websites/svelte_dev` | `on:event` -> `onEvent` (e.g. `onclick`) |

**Context7 usage notes**:
- Requires `POST` + `Accept: application/json, text/event-stream`
- Returns SSE format (`event: message\ndata: {...}`)
- Does not support `resources/list`; only exposes `tools` (`resolve-library-id`, `query-docs`)
