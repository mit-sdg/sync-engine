# sync-engine — Agent Instructions

## Toolchain

This project uses **Vite+** (`vp`), which wraps Vite, Vitest, Rolldown, Oxlint, and Oxfmt.
Use `bun` as the package manager (not `npm`).

### Commands

| Task                      | Command             |
| ------------------------- | ------------------- |
| Install dependencies      | `vp install`        |
| Format, lint, & typecheck | `vp check`          |
| Run tests                 | `vp test`           |
| Typecheck only            | `bun run typecheck` |

**Do not** use `bun test`, `npm`, or `npx` — always use `vp` or `bun run`.

## Docs

- Engine API reference: `docs/api/engine.md`
- Runtime API reference: `docs/api/runtime.md`
- SDK API reference: `docs/api/sdk.md`
- Utilities reference: `docs/api/utils.md`
- Vite+ docs: `node_modules/vite-plus/docs/` or https://viteplus.dev/guide/

## Project Structure

| Directory  | Purpose                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `engine/`  | Core sync engine: concepts, frames, where algebra, pattern matching, observer |
| `runtime/` | App host, lifecycle, job status registry                                      |
| `sdk/`     | Client SDK, HTTP client, CLI client, endpoints                                |
| `utils/`   | Logger, redaction, error serialization, cache                                 |
| `tests/`   | Tests mirroring the source layout                                             |
