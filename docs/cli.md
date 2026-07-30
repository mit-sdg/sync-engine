# Command-line reference

The installed `sync-engine` executable scaffolds projects, compares parsed
concept action/query declarations with class source, and checks or generates
assembly artifacts. Commands follow the [runtime and toolchain support
policy](../SUPPORT.md) and run relative to the current working directory unless
a path says otherwise.

```text
sync-engine <command> [arguments]
```

`sync-engine`, `sync-engine help`, `sync-engine --help`, and `sync-engine -h`
print command help and exit successfully. A command error prints the error
message without a stack and sets exit status 1.

Commands accept only the operands and options shown below. Unknown options,
repeated options, missing option values, and trailing operands are rejected
before a command applies defaults, imports configuration, or writes files.

| Command                                | Result                                                                                | Writes files                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `new <directory>`                      | Creates the runnable one-concept scaffold                                             | Yes; never overwrites an intended template file |
| `check`                                | Compares concept specifications with class source and optionally inspects an assembly | No                                              |
| `artifacts check`                      | Compares both configured artifacts with the assembly                                  | No                                              |
| `artifacts pin`                        | Regenerates both configured artifacts                                                 | Yes                                             |
| `artifacts pin-spec` / `pin-wire`      | Regenerates one configured artifact                                                   | Yes                                             |
| `artifacts manifest` / `spec` / `wire` | Prints one derived representation to standard output                                  | No                                              |

## `sync-engine new`

```text
sync-engine new <directory>
```

`new` writes the one-concept project used by [Getting
started](guide/getting-started.md). The basename of `<directory>` determines
the package name, generated application title, TypeScript identifiers, and
specification filename. It must begin with a lowercase letter and contain only
lowercase letters, digits, and single hyphens. Invalid names are rejected before
the destination directory is created.

The command may create `<directory>` and missing subdirectories. Before writing,
it checks every intended template path. If any intended file already exists,
the command fails and lists the collisions. It does not overwrite those files.
A filesystem failure during writing can leave a partial project; the command
does not provide a transactional rollback.

On success, the command lists the written paths and prints a `Next:` command for
installing, generating, checking, and running the project.

## `sync-engine check`

```text
sync-engine check [--concepts <path...>] [--config path] [--fail-on-warnings]
```

`check` recursively finds `spec.md` under each supplied root. The default root
is `src/concepts`. Each discovered concept directory must contain `registry.ts`,
and that registry must call `registerConcept` with a class imported by name.

The command parses the specification and class source, then compares action and
query names and supported input parameter forms. It does not read State notation
as grammar or compare it with class fields or storage. [Concept specification
format](concept-specification.md) defines the accepted machine grammar and
uninterpreted boundary.

`--concepts` consumes one or more paths, ending at the next option. Each of
`--concepts`, `--config`, and `--fail-on-warnings` may appear at most once.

`--config` also assembles the application and prints its structured diagnostics.
`--fail-on-warnings` promotes warning diagnostics only when `--config` is
present; without a config there are no application diagnostics to promote.

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
does not delete unknown files and is silent on success. Replacement is atomic
per file, not across both artifacts. A later write failure can leave an earlier
artifact updated; the command does not roll back completed writes.

### `pin-spec`

Renders both artifacts but writes only the assembled Markdown specification.

### `pin-wire`

Renders both artifacts but writes only the TypeScript wire module. The module
contains the logical contract followed by each configured projection in
declaration order.

### `manifest`

Prints `sync-engine.application-manifest` version `3` as canonical JSON. The
manifest contains application design, declaration-owned endpoints, input and
wire contracts, validator-presence flags, structured diagnostics, and a digest
over those fields. It excludes occurrences and other runtime state.

### `spec`

For a valid assembly, prints assembly counts and the assembled read-back. The
counts cover registered reactions, views, formers, and serialized `compute`
operations in the exported IR. The last value counts operation occurrences, not
distinct computation names.

### `wire`

Prints the generated TypeScript wire module. It contains one shared preamble,
the logical contract, each configured projection in declaration order, and a
banner naming every projector package and version.

`sync-engine check --config generated.config.ts` prints the same structured
application diagnostics after checking parsed concept action/query declarations
against class source. Diagnostics are advisory unless their severity is
`error`; `--fail-on-warnings` promotes warning diagnostics to a failing
repository gate.

## Artifact failure conditions

Every artifact command imports and assembles the configured application.
Assembly, import, configuration, or rendering failures therefore fail the
command before comparison or writing.

Projection failures also occur before comparison or writing. `projections` must
be an array whose entries provide `project(facts)`. Logical and projected wire
names, app-wide error names, and generated helper names must be distinct valid
TypeScript identifiers, and every projector must provide a nonblank package name
and version as provenance.

After inspection, the command begins assembly drain and waits for idle before
returning. A descriptor that owns generation-only resources may supply a
`close()` callback; the command invokes it after drain, including when inspection
or rendering fails. This cleanup belongs to the descriptor and does not make
ordinary assembly own concept-floor or store resources.

Assembly rejects every local reaction, view, or former. This rejection applies
before every artifact subcommand, including `spec`, can expose a route or write
a path. Local executable behavior remains available only through manual engines
under the `advanced` subpath.

Strict wire generation also rejects a leaf that cannot be traced to the
configured vocabulary type anchor. Generation never emits a successful partial
wire that silently omits an unsupported endpoint.

Treat `pin`, `pin-spec`, and `pin-wire` as source-changing operations. Review
their diffs and run `artifacts check` in continuous integration.
