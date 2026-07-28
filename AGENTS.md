# sync-engine — Agent Instructions

This file is the working guide for coding agents in this repository: the
toolchain to use and where the source lives. If you are a person exploring
`sync-engine`, you are welcome here too — start with the
[project README](README.md) for the pitch and install, and the
[documentation section](README.md#documentation) for the path that fits your work; the sections below are
the day-to-day mechanics.

## Toolchain

This project uses **Bun** for installation and scripts. Vite+ (`vp`) supplies
the formatter, linter, typechecker, and test runner beneath those scripts.

### Commands

| Task                              | Command                      |
| --------------------------------- | ---------------------------- |
| Install dependencies              | `bun install`                |
| Architecture, specs, lint, types  | `bun run check`              |
| Check release-owned source facts  | `bun run release:check`      |
| Run the full test suite           | `bun run test`               |
| Build JavaScript and declarations | `bun run build`              |
| Check declaration snapshot        | `bun run declarations:check` |
| Check packed consumer             | `bun run package:check`      |
| Run all example scenarios         | `bun run scenario`           |
| Check pinned generated artifacts  | `bun run examples:check`     |
| Typecheck only                    | `bun run typecheck`          |

**Do not** use `bun test`, `npm`, or `npx`. Use the package scripts above.
These scripts run from a source checkout; the installed npm package does not
include them.

## Docs

Start with `docs/index.md`. The document owners are:

- Progressive application authoring: `docs/guide/`
- Small tested read constructions: `docs/book.md`
- Exact package exports and API summaries: `docs/public-surface.md`
- Concept file grammar: `docs/concept-specification.md`
- Installed command behavior: `docs/cli.md`
- Execution guarantees: `docs/semantics.md`
- Deployment selection and limits: `docs/operations.md`
- Contributor implementation map: `docs/architecture.md`
- Vite+ docs: `node_modules/vite-plus/docs/` or https://viteplus.dev/guide/

### Contributing to the example book

Add an entry only when it introduces a contrast the book does not already
show. Vary one part of an existing example so readers can compare the two
forms directly. A rejection example should use a construction an author could
reasonably try and quote the exact registration error.

Every TypeScript fence in `docs/book.md` is a byte-exact excerpt from
`tests/docs/book.test.ts`. The same test checks each quoted read-back and error
against a live engine. Add or update the test first, then copy its text into
the book.

## Project Structure

| Directory                      | Purpose                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/language/` … `src/utils/` | Public package subpaths; each directory contains one export-only `index.ts` file                                                    |
| `src/command/`                 | Source for the installed `sync-engine` executable                                                                                   |
| `src/engine/reactions/`        | Reaction capabilities nested under `authoring/`, `concepts/`, and `runtime/`, plus shared concern contracts and facades at the root |
| `src/engine/reads/`            | Where operations, views, formers, lowering, evaluation, IR, and rendering                                                           |
| `src/engine/boundary/`         | Boundary capabilities nested under `protocol/`, `invocation/`, `assembly/`, `client/`, `gateway/`, `http/`, and `wire/`             |
| `src/engine/hosting/`          | Log retention and persistence                                                                                                       |
| `src/engine/tooling/`          | Assembly inspection and generated-artifact implementation                                                                           |
| `src/engine/utils/`            | Shared dependency-neutral utilities and framework primitives                                                                        |
| `docs/`                        | Public guide, API reference, and execution semantics                                                                                |
| `examples/`                    | Runnable applications, shared example concepts, and pinned generated artifacts                                                      |
| `scripts/`                     | Build, package, architecture, declaration, and maintenance commands                                                                 |
| `.github/`                     | Continuous integration using the same named package commands contributors run                                                       |
| `tests/internal/`              | Focused units mirroring reactions, reads, boundary, and hosting                                                                     |
| `tests/package/`               | Source and packed type contracts, the isolated consumer fixture, and generated declarations                                         |
| `examples/*/tests/`            | End-to-end coverage colocated with each self-contained example                                                                      |
| `tests/docs/`                  | Guide source-link and excerpt verification                                                                                          |
| `tests/utils/`                 | Public utility contract coverage                                                                                                    |
| `tests/public-api.test.ts`     | Exact export register, public-package-subpath check, and unsupported-entrypoint check                                               |

Public entrypoints contain exports only. Code under `src/engine/` imports other
engine modules rather than a public entrypoint. The architecture check enforces
these dependency directions and import spellings, rejects unsupported
top-level and test directories, nested barrels, unreachable source, invalid
generated provenance, package export mismatches, and every runtime import SCC
while ignoring type-only edges. The public API test pins the exact export map
and nested constants.

### Import conventions

- **Within one concern:** use relative imports with a `.ts` extension at any
  directory depth: `./module.ts` for a sibling and `../area/module.ts` when
  crossing between nested capability areas of that concern.
- **Crossing a concern or importing from `src/command/`:** use
  `@engine/<concern>/<nested/path>` — no `.ts` extension, for example
  `@engine/reactions/concepts/outcomes`. The tsconfig path mapping resolves it
  during typecheck; the build rewrites it to the emitted dist path before
  packing.
- **Public barrels** (`@mit-sdg/sync-engine/<subpath>`) are for external
  consumers. Engine code and commands do not import them.
