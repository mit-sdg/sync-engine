# Command-line reference

The installed `sync-engine` executable scaffolds projects, compares parsed
concept action/query declarations with class source, and checks or generates
assembly artifacts. Commands require Bun 1.3 or newer and run relative to the
current working directory unless a path says otherwise.

```text
sync-engine <topic> <command>
```

`sync-engine`, `sync-engine help`, `sync-engine --help`, and `sync-engine -h`
print command help and exit successfully. A command error prints the error
message without a stack and sets exit status 1.

## `sync-engine new`

```text
sync-engine new <directory>
```

`new` writes the one-concept project used by [Getting
started](guide/getting-started.md). The basename of `<directory>` determines
the package name, generated application title, TypeScript identifiers, and
specification filename. The command does not validate that the basename
produces legal TypeScript identifiers. Use a name beginning with a letter and
containing letters, digits, or hyphens; a numeric-only or punctuation-only name
can be written successfully but fail typechecking.

The command may create `<directory>` and missing subdirectories. Before writing,
it checks every intended template path. If any intended file already exists,
the command fails and lists the collisions. It does not overwrite those files.
A filesystem failure during writing can leave a partial project; the command
does not provide a transactional rollback.

On success, the command lists the written paths and prints a `Next:` command for
installing, generating, checking, and running the project.

## `sync-engine check`

```text
sync-engine check [--concepts <path...>]
```

`check` recursively finds `spec.md` under each supplied root. The default root
is `src/concepts`. Each discovered concept directory must contain `registry.ts`,
and that registry must call `registerConcept` with a class imported by name.

The command parses the specification and class source, then compares action and
query names and supported input parameter forms. It does not read State notation
as grammar or compare it with class fields or storage. [Concept specification
format](concept-specification.md) defines the accepted machine grammar and
uninterpreted boundary.

Success prints:

```text
Concept action/query source check passed for N concepts.
```

The command fails when no concept directories are found or when any concept
fails. Parseable concept mismatches are collected and printed as bullets.
Filesystem, missing-registry, or source-resolution failures can abort the
command immediately as one stackless error instead of producing the aggregate
list. The command does not modify files.

## `sync-engine artifacts`

```text
sync-engine artifacts <command> [--config path]
```

The configuration path defaults to `generated.config.ts`. The module must
default-export an application descriptor. [Generated descriptor](public-surface.md#generated-descriptor)
lists its fields and defaults.

### `check`

Renders the assembled Markdown read-back and wire contract in memory, then
compares both with their configured files. Success is silent. A mismatch names
the differing file or files and exits with status 1. `check` does not rewrite
artifacts.

### `pin`

Renders and validates both artifacts before its first filesystem effect. The
command creates configured parent directories, skips byte-identical files, and
replaces changed files through a same-directory temporary file and rename. It
does not delete unknown files and is silent on success.

### `pin-spec`

Renders both artifacts but writes only the assembled Markdown specification.

### `pin-wire`

Renders both artifacts but writes only the TypeScript wire contract.

### `manifest`

Prints `sync-engine.application-manifest` version `2` as canonical JSON. The
manifest contains application design, declaration-owned endpoints, input and
wire contracts, validator-presence flags, structured diagnostics, the reviewed
local-behavior contract and observed inventory, and a digest over those fields.
It excludes occurrences and other runtime state.

### `spec`

For a valid assembly, prints assembly counts, the reviewed-local revision and
definition inventory when present, and the assembled read-back. The counts
cover registered reactions, views, formers, unlowered executable reactions,
reviewed local definitions, and serialized `compute` operations in the exported
IR. The last value counts operation occurrences, not distinct computation
names. Read-back includes whole unlowered definitions and reasons as well as
lowered definitions.

### `wire`

Prints the generated TypeScript wire contract.

`sync-engine check --config generated.config.ts` prints the same structured
application diagnostics after checking parsed concept action/query declarations
against class source. Diagnostics are advisory unless their severity is
`error`; `--fail-on-warnings` promotes warning diagnostics to a failing
repository gate.

## Artifact failure conditions

Every artifact command imports and assembles the configured application.
Assembly, import, configuration, or rendering failures therefore fail the
command before comparison or writing.

Assembly rejects every endpoint-local definition and every local view or former
reachable from an endpoint. It also rejects local ordinary reactions that touch
`RequestBoundary`; `AssemblyOptions.localBehavior` has no boundary override.
This rejection applies before every artifact subcommand, including `spec`, can
expose a route or write a path. Non-boundary local definitions require an exact
review contract and remain executable; diagnostics and read-back label their
owners and reasons.

Strict wire generation also rejects a leaf that cannot be traced to the
configured vocabulary type anchor. Generation never emits a successful partial
wire that silently omits an unsupported endpoint.

Treat `pin`, `pin-spec`, and `pin-wire` as source-changing operations. Review
their diffs and run `artifacts check` in continuous integration.
