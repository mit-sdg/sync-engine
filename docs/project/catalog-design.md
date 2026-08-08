# Catalog package design

Status: accepted for initial implementation.

## Product goal

`@mit-sdg/catalog` is a curated source catalog for sync-engine applications. It
provides complete concepts, vocabulary computations, cross-concept composition,
and application bundles that users copy into their own projects and then own.

The catalog replaces a one-purpose scaffold with reusable building blocks. It
is not a runtime framework, package of opaque implementations, remote service,
or source updater. An installed application has no runtime dependency on the
catalog.

The package publishes one executable named `catalog`. During the current beta it
is released in lockstep with its exact `@mit-sdg/sync-engine` peer; catalog lock
records still identify each package snapshot so the release schedules can
separate after the core contract stabilizes.

## User journeys

### First application

The user creates an ordinary Bun and TypeScript package, installs a compatible
sync-engine version, and installs a complete catalog bundle while initializing
catalog metadata:

```sh
bunx --package @mit-sdg/catalog@beta catalog init bundle/operations-room \
  --variant concept/gathering=memory
```

`init` accepts the same entries and selection flags as `add`. Initialization
and installation are one preflighted operation: an invalid entry, missing
package dependency, unresolved variant, or path collision leaves no partial
catalog project.

The bundle contributes application source but does not create the directory,
initialize a package manager, install dependencies, or replace TypeScript
project configuration. This is the eventual replacement for
`sync-engine new`.

### Conventional application

The standard layout needs no path flags:

```sh
bunx --package @mit-sdg/catalog@beta catalog init
bunx --package @mit-sdg/catalog@beta catalog add concept/gathering \
  --variant concept/gathering=memory
bunx --package @mit-sdg/catalog@beta catalog add recipe/member-contributions
```

`init` prints two one-time integration snippets: spread
`catalogRegistrations` and `catalogComputations` into the application concept
set, and spread `catalogComposition` into assembled composition. It never edits
those application modules.

### Customized application

All integration paths are explicit and deterministic:

```sh
bunx --package @mit-sdg/catalog@beta catalog init \
  --concepts app/domain/concepts \
  --computations app/domain/computations \
  --recipes app/policies \
  --concept-set app/system/concept-set.ts \
  --declarations app/generated/catalog-text.d.ts \
  --registrations app/generated/catalog-registrations.ts \
  --composition app/generated/catalog-composition.ts
```

Recipe imports and managed imports are rendered relative to these paths. The
installer does not inspect source to infer architecture and does not require
path aliases, a particular assembly filename, or a particular local
composition layout.

The conventional journey is shorter; the customized journey has the same
safety and capabilities.

## Entry model

Every entry has a stable lowercase ID whose first segment names its kind:

- `concept/<name>`: specification, registration, implementation variant, and
  executable principle/conformance evidence.
- `computation/<name>`: one or more related pure vocabulary computations and
  executable value evidence.
- `recipe/<name>`: one composition module plus an optional paired test. A
  recipe may contain reactions, views, formers, endpoints, and `compute` lines.
- `bundle/<name>`: a dependency selection plus application-level source such as
  a concept set, assembly, edge, scenario, and generated-artifact descriptor.

Each entry has one JSON manifest beside its source. Manifests declare summary,
dependencies, package requirements, copied files, integration metadata, and
available concept variants. They contain no executable configuration.

Dependencies name exact entry IDs, not structural roles. A recipe is tested
against the catalog concept contracts it declares. Catalog installation does
not attempt to prove that an arbitrary application concept is equivalent.

Concept and computation vocabulary names are canonical. Installation aliases
are deliberately omitted: aliases complicate recipe compatibility and make
catalog examples harder to compare. Users may rename source after installing a
complete dependency set, at which point the application owns the adaptation.

## Concept variants

A concept may provide multiple install-time implementation variants. Variants
share one specification, action/query shape, refusal contract, vocabulary name,
and conformance suite, but may use different storage seams and package
requirements.

When more than one variant exists, installation is noninteractive and requires
an explicit selection:

```sh
catalog add concept/gathering --variant concept/gathering=repository
```

Transitive concept dependencies use the same repeated `--variant
<concept-id>=<variant>` syntax. Omission reports all available variants and an
exact retry command before writing. Bundles may constrain supported variants
when their assembly source depends on a particular constructor shape.

Catalog variants differ from engine floors. A catalog variant chooses which
implementation source is copied; an engine floor chooses among factories that
are already in an application.

## Project configuration

`catalog init` writes a root `catalog.json`. It uses conventional defaults,
accepts noninteractive overrides, and records every resolved path so behavior
does not depend on later defaults:

```json
{
  "$schema": 1,
  "concepts": "src/concepts",
  "computations": "src/computations",
  "recipes": "src/composition",
  "conceptSet": "src/concept-set.ts",
  "declarations": "src/catalog/text.generated.d.ts",
  "registrations": "src/catalog/registrations.generated.ts",
  "composition": "src/catalog/composition.generated.ts"
}
```

Paths are project-relative portable paths. Absolute paths, parent traversal,
empty segments, and writes through symbolic links are rejected.

The separately committed `catalog.lock` is deterministic machine-owned JSON.
For each installed entry it records:

- entry ID, kind, catalog package version, and source digest;
- selected concept variant and dependency edges;
- copied destination paths and rendered SHA-256 hashes;
- recipe filename overrides and integration metadata.

Configuration is user-authored policy; the lock is installation provenance.

## Managed integration

The catalog owns only `catalog.lock`, one configured ambient declaration, and
two configured TypeScript integration modules. Copied entry files become
application-owned immediately.

The declaration supplies the `*.md` text-module type needed by concept
registrations, including when a concept is installed without a bundle.

The registration module exports deterministic `catalogRegistrations` and
`catalogComputations` objects. The application uses them once:

```ts
export const applicationConcepts = conceptSet(catalogRegistrations, catalogComputations);
```

Local registrations and computations may be included in those object
expressions. The application remains responsible for avoiding a local name
collision with canonical catalog names.

The composition module imports installed recipe modules as namespaces,
validates manifest-declared member-name uniqueness during installation, and
exports one deterministic `catalogComposition` object. Assembly combines it
with local composition:

```ts
composition: { ...catalogComposition, ...localComposition }
```

The split avoids a cycle: the application concept set imports registrations
and computation functions; recipe modules import the completed application
`concepts` and `computations`; the managed composition module imports recipes.

Managed modules include generated provenance and a do-not-edit notice. If a
managed module was edited, a mutating command refuses rather than overwriting
it.

## Rendering and destinations

Source rendering supports only manifest-declared path tokens. It rewrites
stable catalog module specifiers such as the application concept-set import to
their configured relative path. It does not parse or rewrite TypeScript
structure, rename identifiers, or execute project code.

Concepts and computations install under their configured directories. Each recipe manifest
owns its default module filename under the configured recipe directory. A
collision aborts the complete plan and prints an explicit retry:

```sh
catalog add recipe/member-contributions --file room-membership-policy.ts
```

A recipe has one module and an optional same-basename test; `--file` renames
both consistently. The selected name is recorded in the lock. Concept target
directories and canonical names are not relocatable per entry.

Bundles may contribute project-relative application files. Their collisions
follow the same no-overwrite rule and are never treated as special scaffold
files.

## Ownership and lifecycle

The installer never overwrites copied source. Re-adding an already tracked
entry is a no-op, even when the application has edited it.

Locally modified dependencies do not block installation. The command names the
modified dependencies, warns that the catalog-tested combination no longer
applies, and proceeds; project checks and the application own the result.

`catalog diff [entry...]` compares local files with source rendered from the
currently invoked catalog package. It reports missing files and unified text
differences but never writes. This lets a user inspect a newer catalog without
creating an update mechanism.

`catalog forget <entry...>` ends tracking without deleting source. It refuses
when another tracked entry depends on the target, removes managed integration
for the forgotten entry, and updates the lock. The application may retain,
move, or delete the copied files.

There is no overwrite, source update, merge, or source deletion command.

## Versions and compatibility

Each published catalog package is one jointly tested snapshot with one declared
`@mit-sdg/sync-engine` peer range. `init` and `add` require the target
`package.json` to declare a compatible core dependency.

Projects may contain unrelated entries from different catalog snapshots. An
already installed dependency satisfies an entry from another snapshot only
when its unrendered catalog source digest is identical in both snapshots. A
catalog-source mismatch is rejected; local edits to the correctly sourced
dependency produce the ownership warning described above.

Entries may declare other npm package ranges. Commands verify the target
manifest and, when a requirement is missing, print an exact `bun add` command.
They do not edit `package.json` or invoke a package manager.

## Commands

The initial command surface is:

| Command                     | Behavior                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `catalog init [entry...]`   | Write configuration, managed files, lock, and optional entries |
| `catalog list [kind]`       | List available entries and concise summaries                   |
| `catalog show <entry>`      | Show dependencies, variants, requirements, and copied files    |
| `catalog add <entry...>`    | Resolve and copy an entry dependency closure                   |
| `catalog diff [entry...]`   | Compare application-owned source with this catalog snapshot    |
| `catalog forget <entry...>` | Stop tracking entries without deleting source                  |

Commands are noninteractive, reject unknown or repeated options, print errors
without stacks, and use exit status 1 for command failures. `list` and `show`
work outside an initialized project.

Mutating commands build and validate their complete write plan before the
first effect. New files use exclusive creation, managed replacements use
temporary siblings, and in-process failures restore managed files and roll back
newly created files. Existing copied files are never rollback targets.

Installation does not execute TypeScript or application scripts. Success
prints copied paths, warnings, the one-time integration instructions when
needed, and `bun run check` when that package script exists.

## Catalog quality

Package checks validate every manifest, stable ID, source path, package range,
canonical vocabulary name, recipe member name, variant, and dependency edge.
The complete graph must be acyclic.

Every entry requires executable evidence:

- every concept variant passes the same principle/conformance behavior;
- every computation has focused value and edge-case tests;
- every recipe is assembled with its exact dependency closure and demonstrates
  its declared behavior;
- every bundle installs into an isolated packed-package consumer, generates
  artifacts, typechecks, and runs its scenario.

The initial catalog is a coherent incident-coordination toolkit rather than a
toy counter:

- generic Gathering, Selecting, Discussing, and Alerting concepts;
- memory and repository-backed Gathering implementation variants;
- label-normalization vocabulary computation;
- selection-to-discussion, member-alerting, normalized-selection, membership
  policy, and operations-dashboard recipes;
- a runnable operations-room bundle using those independent entries.

## Core migration

The core `sync-engine` executable keeps `check` and `artifacts` and removes
`new`. The core package no longer ships scaffold templates or scaffold-specific
build and release policy. README and Getting Started use the catalog bundle
flow; core package verification retains independent application fixtures while
catalog package verification owns installation and bundle execution.

## Non-goals

- Runtime imports from `@mit-sdg/catalog`.
- Remote registries or network fetching beyond package installation.
- Automatic concept equivalence or role substitution.
- AST editing of application files.
- Interactive prompts.
- Package-manager initialization or dependency installation.
- Updating, merging, or deleting application-owned source.
