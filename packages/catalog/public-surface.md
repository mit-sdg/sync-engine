# Catalog command reference

`@mit-sdg/sync-engine-catalog` is CLI-only. Its package `exports` object is
empty; consumers use the installed `catalog` executable. The executable reads
shipped manifests and source assets without importing entry modules.

## Commands

```text
catalog list [concept|recipe]
catalog show <entry>
catalog add <entry...> [--floor <name>]
catalog help
```

With no arguments, or with `help`, `--help`, or `-h`, the executable prints
usage and exits successfully.

`list` prints each matching id, kind, and summary. `show` prints requirements,
floor and package summaries, destination paths, and recipe member-to-route
metadata. These commands do not require core and do not import entry modules.

`add` requires a project-root `package.json`. It resolves recipe dependencies,
deduplicates shared concepts, selects one project floor, verifies all current
and requested package requirements, renders output in memory, and validates
paths and ownership before writing. It installs staged source and generated
files, writes `catalog.lock` last, and prints integration guidance. A failed
commit restores files that it replaced.

Repeated `--floor`, comma-separated floor names, unknown options, unavailable
floors, and a floor different from the lock fail before writes. Missing or
incompatible packages also prevent writes; `add` prints an install command and
sets exit status 1. Other errors print one message without a stack and set exit
status 1.

## Project floor

The first add selects `--floor`. When the option is omitted, every resolved
concept must name the same `defaultFloor`; that common default is selected.
Every resolved concept must provide the selected floor. `catalog.lock` fixes the
floor for later additions.

The plan omits registry blocks, implementations, imports, factories, tests, and
package requirements that belong only to another floor.

## Manifest fields

Every manifest has `schema: 1`, a globally unique `id`, `kind`, `summary`,
`packages`, and `files`. An id consists of `concept/` or `recipe/` followed by
one or more lowercase, hyphenated path components. Recipes add `requires` and
`recipe`; concepts add `concept`, `defaultFloor`, and `floors`. Unknown fields
fail validation.

A file declaration contains `source`, `target`, and optional
`render: "floor"`. Sources are portable local entry filenames. Targets must
begin with `$concepts/` or `$recipes/` according to the entry kind; these tokens
map to `src/concepts/` and `src/composition/`. Within each selected floor,
sources and targets are unique, and every relative module import resolves to
another selected target.

Concept metadata contains `name`, `export`, and `registration`. The export is a
TypeScript identifier. Each floor contains `summary`, optional `packages`, and
`files`. The single rendered registry must contain one class marker for every
floor.

Recipe metadata contains `module`, `test`, `members`, and `routes`. The module
and test must name declared files. `members` is the exact
`catalogComposition` allowlist and contains unique TypeScript identifiers.
`routes` must have exactly the same keys. Recipe dependencies must exist, and
the complete dependency graph must be acyclic.

## Package requirements

Every external package imported by copied source must be declared by the entry
or selected floor with a valid semantic-version range. The application may
declare an exact version that satisfies the requirement or a range that is a
subset of it. Non-semver protocols and tags are incompatible; range overlap
alone is insufficient.

The catalog verifies declarations in `package.json`; it does not inspect
`node_modules`. It reads `dependencies`, `devDependencies`, and
`peerDependencies`.
Different declarations for one package across those sections are a conflict.
Requirements from entries already in `catalog.lock` are checked again on every
add.

Missing or incompatible requirements prevent all writes. The command prints
one `bun add --exact <name>@<requirement>...` command and a `Next:` line that
repeats the original add. The command checks declared dependency ranges; it does
not inspect installed packages.

## Lock and ownership

`catalog.lock` stores `schema`, the selected `floor`, fixed `paths`, `entries`,
and `generated`. Each entry records `kind`, the `catalogVersion` and
`sourceDigest` observed when the entry was first installed, `requires`,
`packages`, `integration`, a concept `floor` for concept entries, and `files`.
Each tracked file records `source`, `target`, `hash`, and `class`. Generated
records contain a target and hash. Serialization sorts object keys and ends with
a newline.

`catalogVersion` and `sourceDigest` are installation provenance, not update
markers. A repeated `add` retains both values. It may refresh a rendered
registry hash after validating that the existing registry is still catalog-owned.
It never replaces a copy-owned file. A change to requirements, selected
packages, integration metadata, or rendered-file locations is a schema 1
migration and fails rather than changing provenance.

Lock paths are portable project-relative paths. Absolute paths, parent
traversal, backslashes, empty components, and Windows device names fail
validation. Planning also refuses traversal through a symlink.

Copy-owned files are never rewritten. Rendered registries are rewritten only
when the current bytes match the previous catalog hash. Generated files are
regenerated from the lock only when their current bytes match the previous
generated hash. Byte equality without lock attribution does not establish
ownership.

Repeating an unchanged add performs no writes. When an installed entry's
requirements, selected packages, integration metadata, or rendered-file
locations differ from the current manifest, `add` rejects the entry. Schema 1
does not define a catalog migration.

## Generated modules

`src/catalog/registrations.generated.ts` imports tracked registrations and
exports `catalogRegistrations`. `src/catalog/composition.generated.ts` imports
only declared recipe members and exports `catalogComposition`.
`src/catalog/text.generated.d.ts` declares Markdown text modules. Each generated
file carries a do-not-edit provenance banner.

Recipe assets may import the reserved `@catalog/concepts` specifier, which the
installer rewrites to the application's `src/concept-set.ts`. A recipe's declared
test may also import `@catalog/registrations`; the installer rewrites that specifier
to `src/catalog/registrations.generated.ts` so the test can construct the selected
real floor. Other entry files must declare nonrelative imports as packages.

The catalog does not import generated modules into application-owned files.
Guidance supplies snippets for `src/concept-set.ts` and `src/composition.ts`,
selected-floor assembly construction, TypeScript coverage, generated
configuration, and package scripts. Text checks report unrecognized custom
integration as unverified rather than rewriting it.

## Write boundary

The catalog may write selected source under `src/concepts/` and
`src/composition/`, generated wiring under `src/catalog/`, and `catalog.lock`.
During a commit it may also create sibling temporary or backup files. It never
creates or edits `package.json`, `tsconfig.json`, `src/concept-set.ts`,
`src/composition.ts`, `src/assembly.ts`, `generated.config.ts`, a host, or
package scripts.
