# Svelte Latest Reference

> Last checked: 2026-05-04. This is a concise project reference, not a copy of upstream docs.

---

## 1. Current Upstream Snapshot

- Latest GitHub release checked: `svelte@5.55.5`, published 2026-04-23.
- Official docs: https://svelte.dev/docs/svelte/overview
- Official repository: https://github.com/sveltejs/svelte
- SvelteKit docs: https://svelte.dev/docs/kit

Svelte 5 is the current major line. It uses runes for explicit reactivity and remains compatible with gradual migration patterns from older Svelte code.

---

## 2. Core Concepts

- Svelte is a compiler-based UI framework.
- Svelte 5 uses explicit runes for reactivity.
- `$state` declares reactive state.
- `$derived` declares computed state.
- `$effect` performs side effects when dependencies change.
- `$props` reads component props.
- snippets replace many slot-style composition patterns.

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

## 4. Meristem Usage

M-UI is not part of the MVP, but future Svelte/SvelteKit work should follow:

- SvelteKit + SDUI for the operational interface.
- CLI remains the MVP entrypoint; UI should not become a hidden control plane.
- High-risk UI actions must route through CommandWell and M-Policy.
- Critical operational state must show traceable source IDs.
- Use Svelte 5 runes for new components.

---

## 5. Migration Notes

- Prefer `$state` over implicit top-level reactive `let` patterns for new code.
- Prefer `$derived` over `$:` derivations.
- Prefer `$effect` for side effects; avoid using it for pure computations.
- Read props through `$props`; do not mutate props directly.

---

## 6. Sources

- Svelte official docs: https://svelte.dev/docs/svelte/overview
- Svelte official migration guide: https://svelte.dev/docs/svelte/v5-migration-guide
- Svelte latest release `svelte@5.55.5`: https://github.com/sveltejs/svelte/releases/tag/svelte%405.55.5
- Context7 official-doc mirror used for Svelte 5 runes and migration examples: `/websites/svelte_dev`
