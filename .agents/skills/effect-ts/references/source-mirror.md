# Source Mirror & Local Sources

## Source-First Rule

When working in any repo that uses Effect (`effect` or `@effect/*` in package/dependency files), reference the official Effect source before writing, reviewing, or refactoring Effect code. Do not rely on stale memory, blog posts, or high-level docs alone.

- If the `effect_source` tool is available, use it for `status`, `hydrate`, and `search` instead of hand-rolled shell commands.
- First check for a repo-local shallow source mirror at `.agent-sources/effect/`.
- If it is missing, create it before doing Effect work:
  `mkdir -p .agent-sources && git clone --depth 1 --filter=blob:none https://github.com/effect-ts/effect.git .agent-sources/effect`
- Keep the mirror out of product commits. If needed, add `.agent-sources/` to `.git/info/exclude`, not the project `.gitignore`, unless Joel explicitly wants it committed.
- Search the mirror for current patterns and APIs, especially under `packages/effect/src/` and package tests/examples, before calling something an Effect best practice.

## Local Source References

- **repo-local Effect source mirror** (canonical for current work): `.agent-sources/effect/`
- **effect-solutions** (best practices, docs, examples): `~/Code/kitlangton/effect-solutions/`
- **fallback global Effect monorepo**: `~/Code/effect-ts/effect/`
- Search source for implementations: `grep -r "pattern" .agent-sources/effect/packages/effect/src/`
