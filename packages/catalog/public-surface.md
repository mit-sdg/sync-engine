# Catalog public surface

This reference defines the complete supported surface of `@mit-sdg/catalog`.
The package exposes the `catalog` executable and an empty JavaScript `exports`
map. Package-root imports, deep imports, entry source imports, and internal
TypeScript imports are unsupported.

The catalog and `@mit-sdg/sync-engine` are released at the same exact beta
version. Discovery does not require a project or core installation. `init` and
`add` require the target project to declare a compatible core package and every
package required by the selected entry closure.

## Executable

```text
catalog <command> [arguments]
```

`catalog`, `catalog help`, `catalog --help`, and `catalog -h` print usage and
exit successfully. A command error prints one stackless message to standard
error and sets exit status 1. Commands are noninteractive.

| Command             | Effect                                                  | Writes |
| ------------------- | ------------------------------------------------------- | ------ |
| `list [kind]`       | List entries and summaries                              | No     |
| `show <entry>`      | Describe one entry                                      | No     |
| `init [entry...]`   | Create catalog metadata and optionally install entries  | Yes    |
| `add <entry...>`    | Install entries and their dependency closure            | Yes    |
| `diff [entry...]`   | Compare copied source with the invoked catalog snapshot | No     |
| `forget <entry...>` | Stop tracking entries without deleting copied source    | Yes    |

`list` and `show` work outside a project. `init` uses exactly the current
directory. `add`, `diff`, and `forget` search the current directory and its
ancestors for the nearest `catalog.lock`.

Unknown options, missing option values, repeated options, invalid trailing
operands, and repeated entry operands are errors.

## Entry kinds and shipped IDs

The supported kinds are exactly `concept` and `recipe`.

```text
catalog list [concept|recipe]
```

With no kind, `list` prints all entries sorted by ID. With a kind, it prints
only entries of that kind. Each line contains the ID and summary.

```text
catalog show <entry>
```

`show` prints the ID, summary, kind, direct entry dependencies, entry-level
package requirements, concept variant names and summaries when present, and all
common and variant file targets. It does not expand variant-level package
requirements. An unknown ID is an error.

This package snapshot contains exactly six IDs:

| ID                       | Role                                                                         |
| ------------------------ | ---------------------------------------------------------------------------- |
| `concept/authenticating` | Exact bounded identifiers, secret digests, and opaque principals             |
| `concept/notifying`      | Retained ordered in-app inbox with read and dismissal state                  |
| `concept/profiling`      | One display profile for each opaque external principal                       |
| `concept/sessioning`     | Expiring opaque sessions, rotation, and principal-wide revocation            |
| `recipe/account-center`  | Concrete profiles and a retained inbox behind one validated account boundary |
| `recipe/browser-session` | Identifier-secret registration and same-origin server-side browser sessions  |

`concept/profiling` has `memory` and `repository` variants. The other three
concepts each have one `memory` variant.

## Entry manifest schema

Each indexed entry has one schema-1 `manifest.json`. The common fields are:

| Field      | Required | Meaning                                        |
| ---------- | -------- | ---------------------------------------------- |
| `schema`   | Yes      | Integer `1`                                    |
| `id`       | Yes      | Lowercase ID whose prefix matches `kind`       |
| `kind`     | Yes      | `concept` or `recipe`                          |
| `summary`  | Yes      | Nonempty discovery text                        |
| `requires` | No       | Distinct direct entry IDs                      |
| `packages` | No       | Package names mapped to required range strings |
| `files`    | By kind  | Common copied files                            |

Unknown fields are rejected. The complete indexed dependency graph must contain
every named dependency and must be acyclic. Every declared source file must
exist inside its entry directory.

### Manifest targets

A file target must begin with exactly one of these tokens:

| Token        | Configured destination |
| ------------ | ---------------------- |
| `$concepts/` | `concepts` source root |
| `$recipes/`  | `recipes` source root  |

All files selected for a concept must be below `$concepts/`; all files selected
for a recipe must be below `$recipes/`. A manifest cannot target the project
root, the configured concept-set file, or a generated integration file.

Sources are entry-relative POSIX paths that remain inside the entry. Copied
targets cannot repeat within one selected variant.

### Concept manifests

A concept manifest requires nonempty `variants` and `concept` integration
metadata:

```json
{
  "variants": {
    "memory": {
      "summary": "Process-local implementation.",
      "files": [
        {
          "source": "variants/memory/sample.ts",
          "target": "$concepts/sample/sample.ts"
        }
      ],
      "packages": {}
    }
  },
  "concept": {
    "name": "Sample",
    "registration": "$concepts/sample/registry.ts",
    "export": "sample"
  }
}
```

Common `files` apply to every variant. A selected variant contributes its
`files` and optional package requirements. The common files must include the
declared registration module. Concept names are unique across the catalog.

### Recipe manifests

A recipe manifest requires a `recipe` record:

```json
{
  "recipe": {
    "module": "$recipes/sample.ts",
    "test": "$recipes/sample.test.ts",
    "members": ["SampleEndpoint"]
  }
}
```

`module` and optional `test` must name files in the common `files` array.
`members` is a nonempty array of distinct identifier names. The generated
composition imports only these named members. Helper functions, constants, and
types exported by the recipe module remain available through a direct
application import but are not assembled.

Pure computations and helpers owned by a recipe are ordinary recipe files and
remain below `$recipes/`. The catalog does not generate vocabulary registration
for them. An application that uses one as a named vocabulary computation must
import and register it explicitly through `conceptSet(...)`.

Copied source replaces `@catalog/concepts` with a relative import of the
configured `conceptSet` reference. For a recipe installation, copied source also
replaces `@catalog/recipe` with a relative import of the installed recipe module.
No other source transformation is supported.

## `init`

```text
catalog init [entry...] [path options] [selection options]
```

`init` requires `package.json` in the current directory and refuses if
`catalog.lock` already exists. With no entries, it writes an empty lock and the
three generated files. With entries, it resolves and validates the complete
dependency closure before writing.

Default paths are implicit. `catalog.lock.paths` stores only values that differ
from the defaults. Initialization prints two integration instructions: pass the
generated registration record to `conceptSet(...)`, and spread the generated
composition into the assembly. The catalog does not create the application
concept set or assembly.

If `package.json` defines a string-valued `check` script, a successful mutation
prints `bun run check` as the next command. The catalog does not execute it.

## `add`

```text
catalog add <entry...> [--variant concept/id=name] [--file name.ts]
```

`add` requires at least one distinct entry. It installs each untracked entry and
its untracked transitive dependencies in dependency order. A directly requested
tracked entry is a no-op and is reported as already tracked.

When a tracked entry is a dependency of a new entry, the current catalog
snapshot's source digest must equal the digest recorded by the lock. Missing or
locally edited copied files do not change that catalog digest. They remain
untouched and cause a compatibility warning naming the changed files.

### Variant selection

```text
--variant concept/id=name
```

The option may be repeated for distinct concepts. A concept with one variant
selects it automatically. A concept with several variants requires an explicit
selection the first time it is installed. A selection for an entry outside the
requested dependency closure, a non-concept entry, an unknown variant, or a
second selection for the same concept is an error. A tracked concept retains its
locked variant; it cannot be switched.

### Recipe filename

```text
--file name.ts
```

`--file` is valid only when exactly one explicitly requested recipe is untracked.
The value must be a lowercase kebab-case `.ts` basename without a directory. It
renames the recipe module and, when declared, its paired test to the same stem.
It does not rename dependencies or a tracked recipe.

If the explicitly requested recipe module or test collides with an existing
path, the error supplies a deterministic alternative filename. A dependency
collision supplies no recipe-rename claim.

## Path options

Path options are valid only on `init`. Each option may occur once.

| Option            | Lock field      | Default                                  | Form                   |
| ----------------- | --------------- | ---------------------------------------- | ---------------------- |
| `--concepts`      | `concepts`      | `src/concepts`                           | Directory              |
| `--recipes`       | `recipes`       | `src/composition`                        | Directory              |
| `--concept-set`   | `conceptSet`    | `src/concept-set.ts`                     | `.ts` file reference   |
| `--declarations`  | `declarations`  | `src/catalog/text.generated.d.ts`        | `.d.ts` generated file |
| `--registrations` | `registrations` | `src/catalog/registrations.generated.ts` | `.ts` generated file   |
| `--composition`   | `composition`   | `src/catalog/composition.generated.ts`   | `.ts` generated file   |

All values are project-relative portable paths. Absolute paths, parent
traversal, empty segments, backslashes, control characters, Windows device
names, nonportable punctuation, and segments ending in a dot or space are
rejected. The four file paths must be distinct. The concept-set path is a
reference and is not created.

Writes reject a symbolic link in any destination path. The complete write plan
also rejects equal and ancestor/descendant target overlap, including overlap
with `catalog.lock`.

## Package checks

`init` and `add` read `dependencies`, `devDependencies`, and `peerDependencies`
from the project `package.json`. The combined installation always requires the
catalog's core peer and adds package requirements from every selected or tracked
entry in the requested closure. Two entries requiring different strings for the
same package are incompatible.

If one package name appears in several dependency sections, the
`peerDependencies` declaration takes precedence over `devDependencies`, which
takes precedence over `dependencies`.

A declared range is accepted under these rules:

1. Exact string equality with the required range is accepted.
2. If the requirement is a plain stable version such as `2.3.4`, declarations
   `^2.3.4`, `~2.3.4`, and `>=2.3.4 <2.4.0` are also accepted.
3. An exact prerelease requirement such as `1.0.0-beta.8` accepts only the
   identical declaration. `^1.0.0-beta.8`, `~1.0.0-beta.8`, and other ranges are
   rejected.
4. A `file:` or `workspace:` declaration is checked against the first installed
   package found in the project or an ancestor `node_modules`. Its installed
   version must satisfy the same rules. For an exact first-party prerelease, the
   installed version must therefore be identical.

The current `recipe/browser-session` closure requires exact
`@mit-sdg/sync-engine@1.0.0-beta.8`, exact
`@mit-sdg/sync-engine-http@1.0.0-beta.8`, and the literal
`@types/node` range `^24.0.0`. The HTTP package and Node types come from the
recipe and its Authenticating and Sessioning memory dependencies.

The copied browser-session source is TypeScript. Supported type checking uses
TypeScript `>=6 <7`. The catalog checks manifest package declarations, not a
project's compiler version or `tsconfig.json`.

Missing or incompatible declarations abort before writing and produce one
`bun add --exact ...` command. The catalog never runs that command or another
package-manager operation.

## Generated files

The catalog manages `catalog.lock` and exactly three configured generated files:

- `declarations`, which declares `*.md` imports as strings;
- `registrations`, which exports only `catalogRegistrations`;
- `composition`, which exports `catalogComposition`.

The registration module uses named imports from locked concept registration
modules. The composition module uses named imports for each recipe manifest's
`members`; it does not use namespace imports and does not include undeclared
helper exports. Entries are sorted by ID, and properties retain manifest member
order within each recipe.

Concept names and recipe member names must each be unique among tracked entries
in their category. The catalog does not inspect or merge application-owned
records that consume the generated objects.

Generated files begin with `Generated by @mit-sdg/catalog. Do not edit.`. Before
`add` or `forget`, the catalog verifies their complete expected contents. An
edited or missing generated file aborts the mutation.

## `catalog.lock`

`catalog.lock` is deterministic schema-1 JSON:

```json
{
  "schema": 1,
  "paths": {},
  "entries": {}
}
```

`paths` accepts only `concepts`, `recipes`, `conceptSet`, `declarations`,
`registrations`, and `composition`. Only nondefault values are written.

Each entry record contains:

| Field            | Shape                        | Meaning                                                            |
| ---------------- | ---------------------------- | ------------------------------------------------------------------ |
| `kind`           | Entry kind                   | Must match the ID prefix                                           |
| `catalogVersion` | Nonempty string              | Catalog version that installed the entry                           |
| `sourceDigest`   | Lowercase SHA-256            | Digest of dependencies, packages, integration, variant, and source |
| `requires`       | Distinct entry IDs           | Locked direct dependencies                                         |
| `packages`       | Package-to-range object      | Locked requirements for the selected entry and variant             |
| `variant`        | Lowercase name               | Required for concepts and forbidden for other kinds                |
| `files`          | `{ source, target, hash }[]` | Provenance, rendered project path, and rendered SHA-256            |
| `integration`    | Kind-specific object         | Data used to regenerate imports and records                        |

Concept integration contains `kind: "concept"`, `name`, `export`, and
`registration`. Recipe integration contains `kind: "recipe"`, `module`,
optional `test`, and nonempty distinct `members`. Every entry requires its
matching integration record.

The lock parser rejects unknown fields, malformed IDs and hashes, repeated
targets, missing dependencies, dependency cycles, cross-kind integration,
invalid variant metadata, and integration-name collisions.

## `diff`

```text
catalog diff [entry...]
```

With no operands, `diff` compares all tracked entries. Otherwise it compares the
named distinct tracked entries. The command renders source from the invoked
catalog package using the locked paths, variant, and recipe filename. It reports
missing local files, files removed from the current package snapshot, entries
absent from that snapshot, and unified text differences.

No differences prints `No catalog differences.`. Differences do not change the
exit status. `diff` never writes.

## `forget`

```text
catalog forget <entry...>
```

`forget` requires one or more distinct tracked entries. It refuses when a
remaining tracked entry directly depends on an entry being forgotten. On
success, it removes the selected lock records and their generated registration
or composition properties. Copied source and package declarations remain in the
application.

## Copy ownership and failure guarantees

Copied concept, recipe, specification, helper, and test files become
application-owned when created. Catalog commands never update, merge,
overwrite, or delete copied files. There is no source update or source removal
command.

Mutating commands validate the lock, package requirements, dependency closure,
variants, integration names, generated files, destination uniqueness, existing
paths, and symbolic links before the first planned write. New files use
exclusive creation. Generated replacements use temporary sibling files and
rename.

If a write fails in process, the command attempts to remove files created by
that operation and restore generated files whose replacement began. The command
does not report a partial successful installation. This rollback is an
in-process filesystem procedure, not a durability guarantee against another
filesystem failure, process termination, operating-system failure, or hardware
failure.

Catalog commands do not execute application TypeScript, project scripts, or a
package manager.

## Account Center boundaries

`recipe/account-center` contributes the optional `accountCenter` former and
seven endpoint declarations over Profiling and Notifying. Two declarations
share the delivery route so a missing profile returns a domain error.

| Route                            | Required input                           | Success result                                              | Domain errors                                     |
| -------------------------------- | ---------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- |
| `/account/create`                | `principal`, `displayName`               | `profile`                                                   | `DISPLAY_NAME_REQUIRED`, `PROFILE_ALREADY_EXISTS` |
| `/account/rename`                | `profile`, `displayName`                 | `profile`                                                   | `PROFILE_NOT_FOUND`, `DISPLAY_NAME_REQUIRED`      |
| `/account/get`                   | `principal`                              | `account`: profile and active inbox, or `null`              | None                                              |
| `/account/notifications/deliver` | `profile`, `topic`, `subject`, `message` | `notification`                                              | `PROFILE_NOT_FOUND`                               |
| `/account/notifications/read`    | `profile`, `notification`                | `notification`                                              | `NOTIFICATION_NOT_FOUND`                          |
| `/account/notifications/dismiss` | `profile`, `notification`                | `notification`; active inbox results omit the retained item | `NOTIFICATION_NOT_FOUND`                          |

The `account` object contains exactly `profile`, `principal`, `displayName`, and
`notifications`. Active notifications retain delivery order and contain
`notification`, `topic`, `subject`, `message`, and `read`.

Endpoint validators require exact object keys and nonempty bounded strings.
`principal`, `profile`, `displayName`, `topic`, and `notification` accept at
most 128 UTF-16 code units; `subject` accepts at most 256; `message` accepts at
most 4,096. Profiling applies its additional non-whitespace display-name rule.

Profile creation returns `DISPLAY_NAME_REQUIRED` for a whitespace-only name and
`PROFILE_ALREADY_EXISTS` when a valid name is supplied for a principal that
already has a profile. Rename checks profile existence first: an unknown profile
returns `PROFILE_NOT_FOUND`, including when the supplied name is whitespace
only. Delivery returns `PROFILE_NOT_FOUND` for an unknown profile. Read and
dismiss return `NOTIFICATION_NOT_FOUND` when the notification is unknown or
belongs to another profile. These refusals leave concept state unchanged.

The recipe does not authenticate `principal` or authorize `profile`. A trusted
adapter must bind those fields, and the delivery route must remain a trusted
service operation. The memory implementations lose profiles and notifications
on restart. Notifying retains inbox records but does not send external messages,
deduplicate delivery, or provide exactly-once behavior.

## Browser Session boundaries

`recipe/browser-session` supplies six validated endpoint declarations and the
directly importable `browserSessionHttpPolicy` helper. The helper is not listed
in manifest `members` and is not included in `catalogComposition`.

The recipe's memory variants are process-local and lose credentials, profiles,
and sessions on restart. Registration, profile creation, and session creation
are separate owner actions without a cross-owner transaction. The recipe does
not provide rate limiting, account recovery, verification, multi-factor
authentication, cross-process session storage, or resource authorization. Its
HTTP helper requires a present exact Origin by default and does not implement
CORS. The [HTTP public surface](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md) defines the policy,
cookie, handler, and generated-wire behavior.
