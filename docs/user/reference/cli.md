# Command-line reference

The installed `sync-engine` executable initializes concept-free application
files, compares concept action/query declarations with class source, and checks or generates
assembly artifacts. It supports the Bun range in the [runtime and toolchain
policy](../../../SUPPORT.md) and defaults paths to the current working directory.

```text
sync-engine <command> [arguments]
```

`sync-engine`, `sync-engine help`, `sync-engine --help`, and `sync-engine -h`
print command help and exit successfully. A command error prints the error
message without a stack and sets exit status 1.

Commands accept only the operands and options shown below. Unknown options,
repeated options, missing option values, and extra operands are rejected before
a command applies defaults, imports configuration, or writes files.

| Command                                | Result                                                                                | Writes files                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `setup [directory]`                    | Initializes missing concept-free application files in an existing Bun package         | Missing setup files only; never edits other files |
| `check`                                | Compares concept specifications with class source and optionally inspects an assembly | No                                                |
| `artifacts check`                      | Compares both configured artifacts with the assembly                                  | No                                                |
| `artifacts pin`                        | Regenerates both configured artifacts                                                 | Yes                                               |
| `artifacts pin-spec` / `pin-wire`      | Regenerates one configured artifact                                                   | Yes                                               |
| `artifacts manifest` / `spec` / `wire` | Prints one derived representation to standard output                                  | No                                                |

## `sync-engine setup`

```text
sync-engine setup [directory]
```

`setup` initializes the files used by [Getting started](../guide/getting-started.md).
The directory defaults to the current working directory and must contain a valid
`package.json`. When present, `packageManager` must name Bun. The command creates
neither the directory nor package manifest.

The setup targets are `tsconfig.json`, `generated.config.ts`,
`src/concept-set.ts`, `src/composition.ts`, `src/assembly.ts`, and
`src/main.ts`. Setup handles each target as follows:

- An absent target is eligible to be created.
- A byte-identical target is reported as verified.
- Any other existing target remains unchanged and becomes application-owned.

Before creating a file that imports another setup target, the command checks
whether the dependency exports the expected identifiers. If the check fails,
setup leaves the dependent file absent and prints the required integration.

Setup checks `package.json` for the exact core version, a compatible TypeScript
declaration, `generate` and `start` scripts, and either a `check` or `typecheck`
script. Missing declarations produce guidance; conflicting package declarations
and incompatible versions fail the command. Setup checks only whether each
script is a string, not what the script runs. It never edits `package.json`.
Setup also does not merge or analyze an existing `tsconfig.json` or
`generated.config.ts`; those files follow the target rules above.

A second invocation over unchanged output writes nothing. A filesystem failure
can leave files written earlier in the command because setup does not promise
an all-or-nothing filesystem transaction.

`sync-engine new` is unsupported. It is parsed as an unknown command, and the
resulting usage text names `setup`.

## `sync-engine check`

```text
sync-engine check [--vocabulary-module path | --config path] [--fail-on-warnings]
```

With `--config`, `check` calls the descriptor's `assemble` function and uses the
assembled application's application-owned concept inventory as the registration
source of truth; built-in engine concepts are excluded. The descriptor's
`vocabulary.module` is used only to locate TypeScript class
source; `vocabulary.export` remains the generated wire type anchor and is not
needed for check discovery.

Without a config, `--vocabulary-module` names a module to import and expects its
`vocabulary` export. With neither option, the command uses
`src/concept-set.ts` and `vocabulary` in the current project as a compatibility
convention. The filename has no semantic role. The configured descriptor also
defaults its vocabulary module to `src/concept-set.ts` beside the descriptor,
but can point at any module.

A registration can be imported from a registry module or created by a direct
`registerConcept(...)` call in the concept-set module. Unregistered Markdown
files are not checked.

The runtime registration supplies the class and parsed specification, so the
checker does not statically search for Markdown. The Markdown filename and
location are unrestricted. Applications conventionally register
`design/concepts/Sessioning.md` through the `@design/*` path mapping, but that
layout and an optional registry module are not discovery requirements.

The command compares the parsed specification with the registered class's
action and query names and input keys. It resolves typed parameters through the
nearest TypeScript project, including imported interfaces, aliases, re-exports,
intersections, mapped and utility types, and path mappings. Ambiguous or dynamic
shapes fail closed with their type operation and source location. The command
does not read State notation as grammar or compare it with class fields or
storage. [Concept specification format](concept-specification.md) defines the
accepted grammar, supported source shapes, and uninterpreted boundary.

Static analysis is limited to locating the selected class source needed for
erased TypeScript input types. The `conceptSet` argument must be an object
literal or a local variable initialized with one. Properties and object-spread
registration maps must resolve to direct or imported `registerConcept(...)`
calls, and each registration's `class` must be a named import whose module
specifier resolves directly as a filesystem path. Unsupported or unresolved
class-source shapes fail rather than being omitted.

`--vocabulary-module` and `--config` are mutually exclusive and may each appear
at most once. The former `--concepts` filesystem-root option is unsupported;
use `--vocabulary-module` for an explicit unconfigured root or `--config` for
assembly-driven discovery. Use the descriptor's `vocabulary.module` when a nondefault source
module also needs application diagnostics. `--config` prints the diagnostics
from the same assembly used for discovery; the command assembles and drains the
application once. `--fail-on-warnings` promotes warning diagnostics only when
`--config` is present. Without a config, `check` has no application diagnostics
to promote.

Success prints:

```text
Concept action/query source check passed for N concepts.
```

An empty `conceptSet({})` succeeds and reports zero checked concepts, which
permits a concept-free setup application. A missing selected module fails.
The command also fails when registration discovery, specification parsing,
source resolution, or declaration comparison fails. Findings are collected as
bullets. The command does not modify files.

## `sync-engine artifacts`

```text
sync-engine artifacts <command> [--config path]
```

The configuration path defaults to `generated.config.ts`. The module must
default-export an application descriptor. [Generated descriptor](public-api.md#generated-descriptor)
lists its fields and defaults.

### `check`

Compares the assembled Markdown read-back and wire contract with their
configured files. Success is silent; a mismatch names the files and exits with
status 1. `check` does not rewrite artifacts.

### `pin`

Renders and validates both artifacts before creating parent directories or
replacing changed files through same-directory temporary files and renames. It
skips byte-identical files, deletes no unknown files, and is silent on success.
Each replacement is atomic, but the pair is not: a later failure leaves completed
writes in place.

### `pin-spec`

Renders both artifacts but writes only the assembled Markdown specification.

### `pin-wire`

Renders both artifacts but writes only the TypeScript wire module. The module
contains the logical contract followed by each configured projection in
declaration order.

### `manifest`

Prints `sync-engine.application-manifest` version `5` as canonical JSON. The
manifest contains application design, declaration-owned endpoints, input and
wire contracts, validator-presence flags, structured diagnostics, and a digest
over those fields. It inventories all standard and vocabulary computations,
including unused vocabulary computations, and records each canonical concept
class separately from the implementation selected by assembly. Concept member
roles come from the canonical vocabulary class even when `instances` selects a
replacement. Concept inventories include the parsed authored contract and source
locations when a specification is present. The manifest excludes computation
functions, constructor arguments, floor resources, occurrences, concept State
sections, source paths, object identity, and other runtime state.

### `spec`

For a valid assembly, prints the assembled read-back and counts of registered
reactions, views, formers, and every serialized `compute` occurrence, including
repeated uses of one named computation.

The concept portion renders authored signatures, behavior prose, refusal
messages, Types, and extension sections. It distinguishes registration checks,
evaluated-read cardinality checks, and descriptive fields. Its generated comment
identifies the manifest producer, concept-specification format, and renderer
versions.

### `wire`

Prints the generated TypeScript wire module. It contains one shared preamble,
the logical contract, each configured projection in declaration order, and a
banner naming every projector package and version.

`sync-engine check --config generated.config.ts` prints the same structured
application diagnostics after checking parsed concept action/query declarations
against class source. Diagnostics are advisory unless their severity is
`error`; `--fail-on-warnings` promotes warning diagnostics to a failing check.

Endpoint overlap and coverage warnings are conservative. [Inspection and
rendering](public-api.md#inspection-and-rendering) defines each diagnostic
and the limits of its proof.

## Artifact failure conditions

Every artifact command imports and assembles the application; import,
configuration, assembly, rendering, and projection failures occur before
comparison or writing. `projections` must
be an array whose entries provide `project(facts)`. Logical and projected wire
names, app-wide error names, and generated helper names must be distinct valid
TypeScript identifiers, and every projector must provide a nonblank package name
and a valid SemVer version as provenance. Projector versions are not
restricted to 1.x.

After inspection, the command begins assembly drain and waits for idle before
returning. A descriptor that owns generation-only resources may supply a
`close()` callback; the command invokes it after drain, including when inspection
or rendering fails. This cleanup belongs to the descriptor and does not make
ordinary assembly own concept-floor or store resources.

Assembly rejects local behavior before any artifact subcommand exposes a route
or writes a path. [Portable and local
behavior](semantics.md#portable-and-local-behavior) defines the rejected forms.

Strict wire generation also rejects a leaf that cannot be traced to the
configured vocabulary type anchor. Generation never emits a successful partial
wire that silently omits an unsupported endpoint.

Treat `pin`, `pin-spec`, and `pin-wire` as source-changing operations. Review
their diffs and run `artifacts check` in continuous integration.
