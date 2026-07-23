# sync-engine — Agent Instructions

This file is the working guide for coding agents in this repository: the
toolchain to use and where the source lives. If you are a person exploring
`sync-engine`, you are welcome here too — start with the
[project README](README.md) for the pitch and install, and the
[documentation router](docs/README.md) for the path that fits your work; the sections below are
the day-to-day mechanics.

## Toolchain

This project uses **Bun** for installation and scripts. Vite+ (`vp`) supplies
the formatter, linter, typechecker, and test runner beneath those scripts.

### Commands

| Task                              | Command                      |
| --------------------------------- | ---------------------------- |
| Install dependencies              | `bun install`                |
| Format, lint, and typecheck       | `bun run check`              |
| Run the full test suite           | `bun run test`               |
| Build JavaScript and declarations | `bun run build`              |
| Check declaration snapshot        | `bun run declarations:check` |
| Check packed consumer             | `bun run package:check`      |
| Run both example scenarios        | `bun run scenario`           |
| Check pinned generated artifacts  | `bun run goldens`            |
| Typecheck only                    | `bun run typecheck`          |

**Do not** use `bun test`, `npm`, or `npx`. Use the package scripts above.
These scripts run from a source checkout; the installed npm package does not
include them.

## Docs

Agent readers start with two pages: the example book (`docs/book.md`) —
worked examples of reads with the engine's read-back beside
each, including the mistakes registration catches — and the complete register
(`docs/public-surface.md`). The rest:

- Documentation router and guided curriculum: `docs/README.md`
- Execution guarantees: `docs/semantics.md`
- Ordering, failure, cancellation, persistence, and restart limits:
  `docs/consistency-and-operations.md`
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

| Directory                      | Purpose                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `src/language/` … `src/utils/` | Public package subpaths; each directory contains one export-only `index.ts` file            |
| `src/command/`                 | Source for the installed `sync-engine` executable                                           |
| `src/engine/reactions/`        | Interpreter, matching, firing, instrumentation, occurrence log, and vocabulary refs         |
| `src/engine/reads/`            | Where operations, views, formers, lowering, evaluation, IR, and rendering                   |
| `src/engine/boundary/`         | Endpoints, invocation, gateway, transports, clients, and wire                               |
| `src/engine/hosting/`          | Log retention and persistence                                                               |
| `src/engine/tooling/`          | Assembly inspection and generated-artifact implementation                                   |
| `src/engine/utils/`            | Shared dependency-neutral utilities and framework primitives                                |
| `docs/`                        | Public guide, API reference, and execution semantics                                        |
| `examples/`                    | Runnable applications, shared example concepts, and pinned generated artifacts              |
| `scripts/`                     | Build, package, architecture, declaration, and golden maintenance commands                  |
| `.github/`                     | Continuous integration using the same named package commands contributors run               |
| `tests/internal/`              | Focused units mirroring reactions, reads, boundary, and hosting                             |
| `tests/package/`               | Source and packed type contracts, the isolated consumer fixture, and generated declarations |
| `tests/golden/`                | Pinned integration fixtures                                                                 |
| `tests/examples/`              | End-to-end example application coverage                                                     |
| `tests/docs/`                  | Guide source-link and excerpt verification                                                  |
| `tests/utils/`                 | Public utility contract coverage                                                            |
| `tests/public-api.test.ts`     | Exact export register, public-package-subpath check, and unsupported-entrypoint check       |

Public entrypoints contain exports only. Code under `src/engine/` imports other
engine modules rather than a public entrypoint. The architecture check enforces
these dependency directions, rejects unsupported top-level and test directories,
and the public API test pins the exact export map and nested constants.
