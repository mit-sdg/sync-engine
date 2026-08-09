# Catalog Public Surface

This document defines the complete supported surface of `@mit-sdg/catalog`.
The package is CLI-only: `package.json` exposes the `catalog` executable and an
empty `exports` map. Importing the package root, a deep module, entry source, or
internal TypeScript is unsupported.

The catalog package and `@mit-sdg/sync-engine` are released at the same exact
beta version. The core peer is optional for running discovery commands, but
`init` and `add` require the target application to declare a compatible core
dependency.

## Executable

```text
catalog <command> [arguments]
```

`catalog`, `catalog help`, `catalog --help`, and `catalog -h` print help and
exit successfully. A command error prints one stackless message to standard
error and sets exit status 1.

Commands are noninteractive. Unknown options, repeated options, missing option
values, invalid trailing operands, and repeated entry operands are rejected.
`list` and `show` work outside a project. `add`, `diff`, and `forget` locate the
nearest ancestor containing `catalog.lock`; `init` uses the current directory.

| Command             | Result                                                     | Writes |
| ------------------- | ---------------------------------------------------------- | ------ |
| `list [kind]`       | Lists available entries and summaries                      | No     |
| `show <entry>`      | Describes one entry                                        | No     |
| `init [entry...]`   | Initializes metadata and optionally installs entries       | Yes    |
| `add <entry...>`    | Installs entries and their exact dependency closure        | Yes    |
| `diff [entry...]`   | Compares local files with the invoked package snapshot     | No     |
| `forget <entry...>` | Stops tracking entries without deleting application source | Yes    |

## Discovery

### `list`

```text
catalog list [concept|computation|recipe|bundle]
```

With no kind, `list` prints every entry sorted by ID. With a kind, it prints
only that kind. Each line contains the stable entry ID and its summary.

### `show`

```text
catalog show <entry>
```

`show` prints the entry ID, summary, kind, direct entry dependencies, npm
package requirements, available concept variants, and declared destination
tokens. An unknown ID fails.

### Shipped entries

The package snapshot contains these stable IDs:

| Entry                   | Role                                                                      |
| ----------------------- | ------------------------------------------------------------------------- |
| `concept/profiling`     | One display profile per opaque external principal                         |
| `concept/preferring`    | Ordered owner, scope, key, and value preferences                          |
| `concept/notifying`     | Retained ordered in-app inbox with read and dismiss state                 |
| `recipe/account-center` | Validated profile, preference, trusted inbox, and joined-account boundary |
| `bundle/account-center` | Complete validated memory-backed starter with an asserting scenario       |

`concept/profiling` provides `memory` and `repository` variants.
`bundle/account-center` constrains Profiling to `memory`, so installing the
bundle selects that variant without `--variant`. `concept/preferring` and
`concept/notifying` each provide one `memory` variant and select it
automatically.

This package snapshot contains no computation entry. The `computation` kind and
`catalog list computation` command remain supported.

### Account-center boundaries

The account-center endpoint validators enforce exact object shapes and bounded
strings. They do not authenticate a principal or authorize a profile or
recipient. These fields are caller claims unless a trusted adapter replaces
them with values derived from verified application context.

The account recipe's delivery endpoint is a trusted service operation and
creates an inbox item unconditionally for the bound profile. Preferences do not
automatically enforce delivery policy. Notifying records an in-app item; it does
not send email or push messages, deduplicate retries, or guarantee exactly-once
delivery. The bundle's memory state is process-local and is lost on restart.

## Installation

### `init`

```text
catalog init [entry...] [path options] [selection options]
```

`init` operates on exactly the current directory. It requires `package.json`
and refuses when `catalog.lock` already exists. With no entries, it writes the
empty lock and the three managed files. With entries, initialization and
installation share one complete preflight; failure before commit leaves no
catalog metadata or copied source.

Default paths are implicit. `catalog.lock.paths` contains only path overrides,
so a standard initialization records `"paths": {}`.

When the installed entries include a complete bundle that already imports the
managed registrations and composition, no integration instructions are
printed. Otherwise `init` prints the two application integration steps.

### `add`

```text
catalog add <entry...> [--variant concept/id=name] [--file name.ts]
```

`add` resolves direct and transitive entry dependencies before writing. An
unknown or repeated entry fails. Entries already tracked are no-ops when
requested directly.

For an already tracked transitive dependency, `add` requires the invoked
package snapshot to have the same source digest as the lock. Local changes do
not change that digest: they are retained and produce a warning naming every
changed or missing dependency file.

### Variant selection

`--variant concept/id=name` may be repeated for distinct concepts. A concept
with one implementation selects it automatically. A multi-variant concept
installed directly requires an explicit selection. An entry closure may narrow
a concept to one compatible variant; in that case the declared constraint is
selected automatically. Explicit selections must satisfy every constraint in
the closure.

Selections for concepts outside the requested closure, unknown concepts,
unknown variants, and attempts to switch a tracked concept's variant fail.

### Recipe filenames

`--file name.ts` is valid only with one explicitly requested, untracked recipe.
The value must be a lowercase kebab-case TypeScript basename. It renames the
recipe module and paired test together. It does not rename dependencies or an
already tracked recipe.

If the requested recipe's module or paired test collides, the error gives a
deterministic alternative. A dependency or bundle collision does not claim
that renaming the recipe will resolve it.

## Path Options

Path options are valid only on `init`. Each option may appear once and takes a
project-relative portable path.

| Option            | Lock field      | Default                                  | Kind      |
| ----------------- | --------------- | ---------------------------------------- | --------- |
| `--concepts`      | `concepts`      | `src/concepts`                           | Directory |
| `--computations`  | `computations`  | `src/computations`                       | Directory |
| `--recipes`       | `recipes`       | `src/composition`                        | Directory |
| `--concept-set`   | `conceptSet`    | `src/concept-set.ts`                     | `.ts`     |
| `--declarations`  | `declarations`  | `src/catalog/text.generated.d.ts`        | `.d.ts`   |
| `--registrations` | `registrations` | `src/catalog/registrations.generated.ts` | `.ts`     |
| `--composition`   | `composition`   | `src/catalog/composition.generated.ts`   | `.ts`     |

Paths reject absolute forms, parent traversal, empty segments, backslashes,
control characters, Windows device names, nonportable punctuation, and
trailing dots or spaces. The four file paths must be distinct. Writes reject a
symbolic link in any destination path. The complete write plan also rejects
exact or ancestor/descendant target overlap, including overlap with
`catalog.lock`.

## Comparison And Forgetting

### `diff`

```text
catalog diff [entry...]
```

With no operands, `diff` compares every tracked entry. Otherwise it compares
the named tracked entries. It renders source from the currently invoked catalog
package using the locked variant, paths, and recipe filename. It reports
missing local files, files removed from the current package snapshot, entries
absent from that snapshot, and unified text differences. No difference prints
`No catalog differences.`. The command never writes and does not change its
exit status merely because differences exist.

### `forget`

```text
catalog forget <entry...>
```

`forget` requires one or more distinct tracked entries. It refuses when a
remaining tracked entry directly depends on one being forgotten. On success it
removes those lock records and their managed imports, then warns that copied
source was retained. It never removes source or npm dependencies.

## Resolution And Package Requirements

Entry dependencies are stable exact IDs. The complete package-owned graph must
be acyclic and every dependency must exist. Installation preserves dependency
order while generated integration modules sort entries by ID.

`init` and `add` read the target `package.json`. Requirements may be declared in
`dependencies`, `devDependencies`, or `peerDependencies`. Missing or
incompatible requirements fail with one exact `bun add --exact` command; the
catalog does not run it. A `file:` or `workspace:` core declaration is accepted
only when the first installed package found from the project through ancestor
`node_modules` directories satisfies the catalog's exact peer.

## `catalog.lock`

`catalog.lock` is deterministic, machine-owned JSON and must be committed. The
top-level schema is:

```json
{
  "schema": 1,
  "paths": {},
  "entries": {}
}
```

`paths` accepts only the seven path names listed above and stores only values
that differ from defaults. Every entry record has these fields:

| Field            | Shape                                      | Meaning                                      |
| ---------------- | ------------------------------------------ | -------------------------------------------- |
| `kind`           | Entry kind                                 | Must match the ID prefix                     |
| `catalogVersion` | Nonempty string                            | Package version that installed the entry     |
| `sourceDigest`   | Lowercase SHA-256                          | Digest of manifest-owned source and metadata |
| `requires`       | Distinct entry IDs                         | Locked direct dependencies                   |
| `packages`       | Package name to required range             | Locked npm requirements                      |
| `variant`        | Lowercase variant name, concepts only      | Installed implementation variant             |
| `files`          | Array of `{ source, target, hash }`        | Provenance, destination, rendered SHA-256    |
| `integration`    | Kind-specific integration record, optional | Managed registration or composition data     |

Concept integration records contain `kind: "concept"`, `name`, `export`, and
`registration`. Computation records contain `kind: "computation"`, `module`,
and distinct `exports`. Recipe records contain `kind: "recipe"`, `module`, an
optional `test`, and distinct `members`. Bundles have no integration record.

The parser rejects unknown fields, malformed hashes and identifiers, repeated
targets, missing dependencies, cycles, and incompatible integration ownership.

## Managed Files

The catalog owns exactly these configured files plus `catalog.lock`:

- the ambient `*.md` declaration;
- the module exporting `catalogRegistrations` and `catalogComputations`;
- the module exporting `catalogComposition`.

Managed files begin with `Generated by @mit-sdg/catalog. Do not edit.`.
Mutating commands verify their complete expected content and refuse if a file
was edited or removed. The concept set, assembly, copied entries, tests, and
bundle files are application-owned.

## Write And Failure Guarantees

Mutating commands validate package requirements, variants, dependency
compatibility, integrations, destination uniqueness, existing paths, and
symbolic links before the first write. New files use exclusive creation.
Managed replacements use temporary siblings and rename. An in-process failure
removes newly created files and restores managed originals.

Catalog commands never execute application TypeScript, project scripts, or a
package manager. They never overwrite copied source. There is no update, merge,
overwrite, or source-removal command.
