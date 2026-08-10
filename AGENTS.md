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
| Update owned release manifests    | `bun run release:update`     |
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

`docs/user/index.md` and `docs/user/llms.txt` are for agents using sync-engine in an
application. This file and `CONTRIBUTING.md` are the entrypoints for agents and
people changing the sync-engine repository.

The consumer document owners are:

- Semantic design decisions: `docs/user/design.md`; design review: `docs/user/guide/reviewing-a-design.md`
- Progressive application authoring: `docs/user/guide/`
- Application model explanation: `docs/user/overview.md`
- Small tested read constructions: `docs/user/guide/read-construction.md`
- Exact core exports and API summaries: `docs/user/reference/public-api.md`
- HTTP exports and API summaries: `packages/http/public-surface.md`
- Analysis exports and API summaries: `packages/analysis/public-surface.md`
- Catalog command and schema contract: `packages/catalog/public-surface.md`
- Concept file grammar: `docs/user/reference/concept-specification.md`
- Installed command behavior: `docs/user/reference/cli.md`
- Execution guarantees: `docs/user/reference/semantics.md`
- Deployment selection and limits: `docs/user/reference/operations.md`
- Agent-oriented consumer index: `docs/user/llms.txt`

The project document owners are:

- Contributor workflow: `CONTRIBUTING.md`
- Contributor documentation map: `docs/project/index.md`
- Contributor implementation map: `docs/project/architecture.md`
- Release procedure: `docs/project/releasing.md`
- Coding-agent checkout instructions: `AGENTS.md`
- Vite+ docs: `node_modules/vite-plus/docs/` or https://viteplus.dev/guide/

Repository-wide documents under `docs/` must live in `docs/user/` or
`docs/project/` and appear in that directory's `index.md` catalog. Package-owned
guides and API references remain with their package and are linked from
`docs/user/index.md`. Do not add another root document or put temporary notes
under `docs/`.

### Contributing to the example book

Add an entry only when it introduces a contrast the book does not already
show. Vary one part of an existing example so readers can compare the two
forms directly. A rejection example should use a construction an author could
reasonably try and quote the exact registration error.

Every TypeScript fence in `docs/user/guide/read-construction.md` is a byte-exact excerpt from
`tests/docs/book.test.ts`. The same test checks each quoted read-back and error
against a live engine. Add or update the test first, then copy its text into
the book.

## Project Structure

| Directory                        | Purpose                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/language/` … `src/tooling/` | Public package subpaths; each directory contains one export-only `index.ts` file                                                    |
| `src/command/`                   | Source for the installed `sync-engine` executable                                                                                   |
| `src/engine/reactions/`          | Reaction capabilities nested under `authoring/`, `concepts/`, and `runtime/`, plus shared concern contracts and facades at the root |
| `src/engine/reads/`              | Where operations, views, formers, lowering, evaluation, IR, and rendering                                                           |
| `src/engine/boundary/`           | Boundary capabilities nested under `protocol/`, `invocation/`, `assembly/`, `client/`, `gateway/`, and `wire/`                      |
| `packages/http/`                 | Independently published HTTP transport and its package-owned API, declaration, and packaging tests                                  |
| `packages/analysis/`             | Independently published analysis companion and its package-owned API, declaration, and packaging tests                              |
| `packages/catalog/`              | CLI-only curated source catalog, entry assets, lock/installer implementation, and package-owned tests                               |
| `src/engine/hosting/`            | Log retention and persistence                                                                                                       |
| `src/engine/tooling/`            | Assembly inspection and generated-artifact implementation                                                                           |
| `src/engine/utils/`              | Shared dependency-neutral utilities and framework primitives                                                                        |
| `docs/user/`                     | Consumer guide, API reference, execution semantics, and design guidance                                                             |
| `docs/project/`                  | Contributor-only implementation architecture and release procedure                                                                  |
| `examples/`                      | Runnable applications, shared example concepts, and pinned generated artifacts                                                      |
| `scripts/`                       | Build, package, architecture, declaration, and maintenance commands                                                                 |
| `.github/`                       | Continuous integration using the same named package commands contributors run                                                       |
| `tests/internal/`                | Focused units mirroring reactions, reads, boundary, and hosting                                                                     |
| `tests/packaging/`               | Core-owned source contracts, packed consumer contract, application fixture, and declaration snapshot                                |
| `examples/*/tests/`              | End-to-end coverage colocated with each self-contained example                                                                      |
| `tests/docs/`                    | Guide source-link and excerpt verification                                                                                          |
| `tests/internal/utils/`          | Shared utility implementation coverage                                                                                              |
| `tests/public-api.test.ts`       | Exact core export register, public-package-subpath check, and unsupported-entrypoint check                                          |

Public entrypoints contain exports only. Code under `src/engine/` imports other
engine modules directly. The architecture check enforces
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
