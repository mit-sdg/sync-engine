# Contributing

Preserve the public package boundary, generated artifacts, and documented
execution contracts. The [project documentation map](docs/project/index.md)
classifies contributor material. Before moving implementation files, read
[Engine architecture](docs/project/architecture.md). Before changing observable
runtime behavior, read [Execution semantics](docs/user/reference/semantics.md).
Compatibility and vulnerability work must follow the [support
policy](SUPPORT.md) and [security policy](SECURITY.md).

## Set up the checkout

```sh
bun install
bun run check
bun run test
```

Use Bun for installation and package scripts. Do not replace these commands
with `npm`, `npx`, or `bun test`; the repository scripts use Vite+ and include
project-specific configuration.

## Checks by change type

| Change                           | Required checks                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------- |
| Documentation only               | `bun run check`, relevant documentation tests, and local-link review                   |
| Concept or composition behavior  | `bun run check`, `bun run test`, `bun run examples:check`                              |
| Public exports or types          | `bun run check`, `bun run test`, `bun run declarations:check`, `bun run package:check` |
| Generated-artifact logic         | `bun run check`, `bun run test`, `bun run examples:check`, `bun run scenario`          |
| Packaging, CLI, or release files | Full suite below, including `bun run release:check`, package checks, and audit         |

Run the full suite before submitting a change that crosses more than one area:

```sh
bun run check
bun run release:check
bun run test
bun run coverage
bun run build
bun run declarations:check
bun run examples:check
bun run scenario
bun run package:check
bun audit
```

## Generated files

Do not hand-edit these outputs:

- `tests/packaging/declarations.snapshot.txt` and
  `packages/*/tests/declarations.snapshot.txt` — update with
  `bun run declarations:pin` after an intentional declaration change;
- `examples/*/generated/*.md` and `examples/*/generated/wire.ts` — update with
  `bun run artifacts:pin` from the owning example or with
  `bun scripts/examples.ts pin` for all registered examples.

Review generated diffs as public contract changes. The check commands compare
the committed files with fresh output.

Each packed consumer contract remains in its owning workspace under
`tests/packaging/` and is named `<workspace-id>-consumer-contract.ts`. The core
workspace uses the repository-level `tests/packaging/` directory. Runtime
consumer scenarios stay beside the contract that owns them.
`scripts/verify-package.ts` copies the registered fixtures into one isolated
consumer.

## Public entrypoints

The six files under `src/<subpath>/index.ts` are export-only core public
barrels. Workspace packages expose their own export-only public entrypoints and
may import only supported core subpaths. Internal engine code imports engine
modules directly. The architecture check enforces dependency direction and
rejects unsupported entrypoints.

An export change requires updates to the owning public API reference and
declaration snapshot. Each workspace's `tests/public-api.test.ts` checks its
exact export register; the core workspace uses the repository-level
`tests/public-api.test.ts`.

## Documentation

Repository-wide documents under `docs/` must live in `docs/user/` or
`docs/project/` and appear exactly once in that audience's `index.md` catalog.
Package-owned guides and API references remain with their package. Root and
core documentation must not duplicate package-specific setup, behavior, or API
contracts. Temporary notes do not belong under `docs/`.

Every TypeScript fence in `docs/user/guide/read-construction.md` is a byte-exact excerpt from
`tests/docs/book.test.ts`. Add or change the test first, then copy the exact
text and generated read-back into the book.

Guide excerpts with a `Source:` label must remain byte-exact with that source.
Prefer small complete examples that show cleanup and failures where relevant.
Do not state a general guarantee from one example test; update the authoritative
reference only when implementation and contract tests establish the behavior.

## Release work

Do not commit, tag, or publish a release as part of an ordinary contribution.
After changing root-manifest version or toolchain facts, run
`bun run release:update` and review the standalone-manifest changes. Release
maintainers follow the [Contributor release
procedure](docs/project/releasing.md) after all changes reach `main`.
