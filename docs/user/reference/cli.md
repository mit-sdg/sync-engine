# Command-line reference

The installed `sync-engine` executable initializes application files, checks the
complete configured design contract, and checks or regenerates assembly
artifacts. Paths are relative to the current working directory unless stated
otherwise.

```text
sync-engine <command> [arguments]
```

Help exits successfully. A command error prints a message without a stack and
sets exit status 1. Unknown, repeated, or mutually exclusive options, missing
values, and extra operands are rejected before configuration is imported or
files are written.

| Command                                        | Result                                                                                  | Writes files             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| `setup [directory]`                            | Initializes missing concept-free application files in an existing Bun package           | Missing setup files only |
| `check [--config path]`                        | Checks concept source, registered design, vocabulary, and selected declaration coverage | No                       |
| `artifacts check [--config path]`              | Compares configured artifacts with the complete selected design                         | No                       |
| `artifacts pin [--config path]`                | Regenerates both configured artifacts                                                   | Yes                      |
| `artifacts pin-spec [--config path]`           | Regenerates generated Markdown only                                                     | Yes                      |
| `artifacts pin-wire [--config path]`           | Regenerates generated TypeScript only                                                   | Yes                      |
| `artifacts manifest/spec/wire [--config path]` | Prints one derived representation                                                       | No                       |

## `sync-engine setup`

```text
sync-engine setup [directory]
```

The directory defaults to the current working directory and must contain a
valid `package.json`. When `packageManager` is present, it must name Bun. The
command creates neither the directory nor package manifest.

Setup targets `tsconfig.json`, `generated.config.ts`, `src/vocabulary.ts`,
`src/assembly.ts`, and `src/main.ts`. Its concept-free generated config contains
an explicit `design: { version: 1, documents: [] }` block.

For each target, setup creates an absent file, verifies a byte-identical file,
and leaves any other existing file unchanged as application-owned. Before it
creates a file that imports another setup target, it checks that dependency's
expected exports. A failed dependency check leaves the dependent file absent
and prints the required integration.

Setup checks the core and TypeScript dependency declarations and the expected
scripts but never edits `package.json`. It does not merge an existing tsconfig
or generated config. A second invocation over unchanged output writes nothing.
Filesystem failures can leave earlier files in place; setup is not an
all-or-nothing filesystem transaction.

## `sync-engine check`

```text
sync-engine check [--config path] [--fail-on-warnings]
```

A generated application config is required. Its path defaults to
`generated.config.ts`; `--config path` selects another descriptor. The removed
`--vocabulary-module` option and no-config concept-set compatibility mode are
unsupported.

The config must default-export an application descriptor with an `assemble`
function and a versioned `design` block. The checker assembles the selected
application once and checks the exact variant returned by that descriptor.
Built-in engine concepts and core-generated reactions are excluded from
author-owned coverage requirements.

### Concept checks

For each selected application concept, `check`:

- traces the static Markdown import supplying `registerConcept(...).spec`;
- verifies that the source file matches the registered text;
- parses the strict ordered version-1 concept format;
- compares action and query member names;
- compares input, action-result, and query-row field names and optionality;
- checks successful branch return names and refusal mappings; and
- records source provenance.

Dynamic or unresolvable spec construction fails. TypeScript source analysis
uses the nearest project configuration and resolves supported aliases,
interfaces, intersections, mapped and utility types, and imports. Unsupported,
open, ambiguous, cyclic, or otherwise unresolved shapes fail closed instead of
being skipped. `field?: T` and `field: T | undefined` have equivalent
optionality.

The checker does not claim semantic equivalence between authored type names and
TypeScript types. It retains raw State but does not parse SSF or compare State
with class fields, storage, or vocabulary target names.

### Application-design checks

For the configured design corpus, `check`:

- accepts only explicit local `file:` URLs;
- parses one optional vocabulary document and every listed prose document;
- inventories all normalized source contents for provenance and digests;
- validates application `concrete` declarations and direct `is` bindings;
- resolves every `reaction:`, `view:`, `former:`, and `computation:` link;
- requires coverage for every selected authored reaction/endpoint tree, named
  view, and named former;
- requires exactly one declaration for every executable computation; and
- rejects authored declarations that are absent from the selected assembly.

The checker validates links and coverage, not the truth of ordinary prose. It
also does not parse State or prove computation-body semantics.

`--fail-on-warnings` promotes application warnings. Errors always fail;
informational diagnostics remain advisory. The command modifies no files.

## Generated application configuration

Every command in this section imports the same generated descriptor. The config
path defaults to `generated.config.ts`.

The required application design block is:

```text
design: {
  version: 1,
  vocabulary?: URL,
  documents: URL[],
}
```

`vocabulary` is required when a selected concept has an external type or the
application declares a concrete type. `documents` can be empty. All URLs must
be local `file:` URLs. A separate assembly variant uses a separate config.

Configuration source must be statically inspectable where a command needs
source provenance. Import, config, assembly, source, design, and projection
errors occur before artifact comparison or writing.

## `sync-engine artifacts`

```text
sync-engine artifacts <command> [--config path]
```

All artifact commands enforce the complete configured design contract. Runtime
`assemble(...)` alone does not load these documents.

### `check`

Renders the complete plan and compares generated Markdown and TypeScript with
their configured paths. Success is silent. A mismatch names affected files and
exits with status 1. No files are rewritten.

### `pin`

Renders and validates both outputs before creating parent directories or
replacing changed files through same-directory temporary files and renames.
Byte-identical files are skipped and unknown files are not deleted. Each
replacement is atomic, but the pair is not: a later failure can leave an earlier
replacement in place.

### `pin-spec` and `pin-wire`

Both validate the complete artifact plan. `pin-spec` writes only generated
Markdown; `pin-wire` writes only generated TypeScript. Neither permits a
successful partial design.

### `manifest`

Prints canonical JSON for `sync-engine.application-manifest`, version `1`. The
schema is a hard reset: earlier application-manifest versions are rejected and
have no compatibility decoder.

The manifest retains normalized raw concept State, structured concept
declarations, definition and instance identities, resolved vocabulary,
application declaration identities, computation signatures, source locations,
and digests over registered design contents. It excludes executable functions,
constructor arguments, floor resources, object identity, occurrence state, and
other runtime-only values.

### `spec`

Prints generated Markdown read-back. It shows:

- reaction and endpoint lowering with each authored tree's stable identity;
- named view and former definitions;
- all source locations that cover each selected declaration;
- structured concept signatures, cardinalities, refusals, definition names,
  instances, and source links;
- concrete types and resolved external bindings; and
- computation signatures and source links.

It does not copy application prose, Purpose, Principle, raw State, action/query
bodies, vocabulary explanations, or computation bodies. Concept State remains
in the manifest and digest even though it is omitted from read-back.

### `wire`

Prints the generated TypeScript wire module. Generated TypeScript constrains
typed callers but does not validate runtime values; endpoint validators remain
required where runtime validation is needed.

## Provenance and source links

Normalized full contents of every registered application-design document
participate in generated provenance. A prose-only edit therefore changes the
artifact input digest.

Generated Markdown uses host-independent relative links to authored files and
reports exact one-based source lines separately. When several passages cover one
declaration, all source locations appear. Files outside the application
directory use relative paths such as `../`.

## Artifact failure and cleanup

Every artifact command imports and assembles the selected application before
exposing output. Local executable-only behavior, invalid declaration identities,
incomplete design coverage, vocabulary errors, projection errors, and strict
wire-provenance failures reject the complete plan.

After inspection, the command drains the assembly. A descriptor may provide a
`close()` callback for generation-only resources; it runs after drain, including
when inspection or rendering fails. This callback does not transfer ownership
of ordinary concept-floor or store resources to assembly.

Treat `pin`, `pin-spec`, and `pin-wire` as source-changing operations. Review
their diffs and run `sync-engine artifacts check` in continuous integration.
