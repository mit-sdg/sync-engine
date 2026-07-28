# Command-line reference

The installed `sync-engine` executable scaffolds projects, checks concept
specifications, and checks or generates assembly artifacts. Commands require
Bun 1.3 or newer and run relative to the current working directory unless a
path says otherwise.

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
query names and supported input parameter forms. [Concept specification
format](concept-specification.md) defines the accepted grammar and validation
boundary.

Success prints:

```text
Specification check passed for N concepts.
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

Prints the versioned application manifest as canonical JSON. The manifest
contains portable design, declaration-owned endpoints, input and wire contracts,
validator-presence flags, and structured diagnostics. It excludes occurrences
and other runtime state.

### `spec`

For an assembly with no non-portable endpoint, prints assembly counts, reports
non-portable non-endpoint reactions, and prints the assembled read-back. The
counts cover registered reactions, views, formers, unlowered executable
reactions, and serialized `compute` operations in the exported IR. The last
value counts operation occurrences, not distinct computation names.

### `wire`

Prints the generated TypeScript wire contract.

`sync-engine check --config generated.config.ts` prints the same structured
application diagnostics after checking concept specifications. Diagnostics are
advisory unless their severity is `error`; `--fail-on-warnings` promotes warning
diagnostics to a failing repository gate.

## Artifact failure conditions

Every artifact command imports and assembles the configured application.
Assembly, import, configuration, or rendering failures therefore fail the
command before comparison or writing.

Artifact rendering rejects an executable endpoint that cannot be lowered to a
complete portable contract. The diagnostic names the endpoint path, reaction,
and unsupported construction. This rejection applies to every artifact
subcommand, including `spec`. Non-endpoint reactions may remain
executable-only; the assembled read-back reports them as unlowered.

Strict wire generation also rejects a leaf that cannot be traced to the
configured vocabulary type anchor. Generation never emits a successful partial
wire that silently omits an unsupported endpoint.

Treat `pin`, `pin-spec`, and `pin-wire` as source-changing operations. Review
their diffs and run `artifacts check` in continuous integration.
