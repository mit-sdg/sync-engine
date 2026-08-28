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

| Command                                                                           | Result                                                                        | Writes files                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `setup [directory]`                                                               | Completes a Bun package and initializes absent concept-free application files | `package.json`, Bun install, missing templates |
| `check-design <paths...> [--format json]`                                         | Checks the form of an explicit mixed authored-design corpus before assembly   | No                                             |
| `verify [--config path] [--fail-on-warnings] [--show-advisories] [--format json]` | Runs configured design, application, and artifact checks and reports outcomes | No                                             |
| `check [--config path] [--fail-on-warnings] [--show-advisories] [--format json]`  | Checks concept source, exact instances, bindings, and declaration coverage    | No                                             |
| `artifacts check [--config path] [--format json]`                                 | Compares configured artifacts with the complete selected design               | No                                             |
| `artifacts pin [--config path]`                                                   | Regenerates both configured artifacts                                         | Yes                                            |
| `artifacts pin-spec [--config path]`                                              | Regenerates generated Markdown only                                           | Yes                                            |
| `artifacts pin-wire [--config path]`                                              | Regenerates generated TypeScript only                                         | Yes                                            |
| `artifacts manifest/spec/wire [--config path]`                                    | Prints one derived representation                                             | No                                             |
| `artifacts diff <old-manifest> [--config path]`                                   | Compares a saved manifest with the configured application                     | No                                             |

## JSON validation output

`check-design`, `check`, `artifacts check`, and `verify` accept `--format json`.
Without that option, each command retains its human-readable output. In JSON mode, a
command writes exactly one JSON document to stdout and suppresses its human text. A
failed validation still exits with status 1 after writing its document.

`check-design`, `check`, and `artifacts check` emit this supported version-1 report:

```json
{
  "format": "sync-engine.diagnostic-report",
  "version": 1,
  "command": "check",
  "status": "passed",
  "diagnostics": []
}
```

`command` is `check-design`, `check`, or `artifacts check`; `status` is `passed` or
`failed`. Each `diagnostics` entry has `code`, `severity`, and `message`, and may have
`path`, `line`, `column`, and `suggestion`. Unavailable source facts are omitted, not
encoded as `null` or synthetic coordinates. Severity is one of `advice`, `error`,
`info`, or `warning`. A producer that exposes only an error message (such as an
artifact comparison failure) uses a command-level code and omits unavailable location
and suggestion fields.

`verify` serializes its existing report directly with
`format: "sync-engine.verification-report"` and `version: 1`. Its `configuration`
and `steps` fields retain their normal status and optional failure `detail`; it does
not reshape those step details into diagnostic records. `--show-advisories` controls
human text only and does not filter JSON output; the `check` diagnostic report retains
every diagnostic without it.

## `sync-engine setup`

```text
sync-engine setup [directory]
```

The directory defaults to the current working directory and must exist. When
`package.json` is absent, setup creates a minimal private ES-module package. Otherwise
the manifest must be valid JSON. Setup adds the installed package's canonical Bun
`packageManager` when absent; an existing value must name Bun and is preserved. The
command never creates the target directory.

Setup validates dependency declarations across `dependencies`, `devDependencies`, and
`peerDependencies`. Different declarations for the same managed package are a
conflict. It completes these missing managed fields:

- adds the canonical Bun `packageManager` field;
- adds the exact installed `@mit-sdg/sync-engine` version to `dependencies`;
- adds the installed package's supported TypeScript range to `devDependencies`;
- adds its supported `@types/bun` and `@types/node` ranges to `devDependencies`; and
- adds missing `generate`, `check`, and `start` scripts.

The standard scripts are:

```json
{
  "generate": "sync-engine artifacts pin",
  "check": "sync-engine check && sync-engine artifacts check && tsc --noEmit",
  "start": "bun src/main.ts"
}
```

An existing compatible dependency declaration is preserved in its existing section.
The core declaration must equal the running core version; TypeScript, `@types/bun`, and
`@types/node` ranges must be subsets of the supported ranges. Every existing script is preserved,
even when its command differs from the standard. Invalid fields, conflicting
declarations, and incompatible ranges fail before `package.json` is written.

When the manifest changes, setup writes `package.json` and then runs `bun install`
before writing templates. An installation failure is reported as partial failure: the
manifest, and any Bun lockfile work, may remain changed, while setup source and
configuration templates remain unwritten. Rerun setup after correcting installation.
An unchanged manifest does not run installation, so an unchanged second invocation is
idempotent.

Setup targets `tsconfig.json`, `generated.config.ts`, `src/concepts.ts`,
`src/assembly.ts`, and `src/main.ts`. The generated `tsconfig.json` loads both Bun and
Node ambient types. Its concept-free generated config contains
`design: { version: 1, documents: [] }`. For each target, setup creates an absent file,
verifies a byte-identical file, and leaves every other existing file unchanged as
application-owned. It never merges or rewrites existing source, config, or tsconfig.
Before creating a file that imports another setup target, it checks that dependency's
expected exports. A failed dependency check leaves the dependent file absent and
prints the required integration.

Template writes are not one filesystem transaction. A filesystem failure reports how
many templates were written; existing application files remain untouched, and a later
setup can complete the missing files.

## `sync-engine check-design`

```text
sync-engine check-design <paths...> [--format json]
```

Each operand is an explicit Markdown file. At least one path is required; the only
accepted option is `--format json`. Operands can mix concept specifications, composition documents, and
application-types documents in any order or location. The command classifies valid
files by their contents rather than their names or paths, checks them in operand order,
and reports every missing, non-regular, unreadable, or invalid file instead of stopping
at the first. A file it cannot parse takes no part in the checks that span documents. An
ambiguous plural pair is reported as advice without failing the check; otherwise success
prints only the number of checked files.

Concept documents must pass the strict version-1 concept parser.
Application-design documents use the same parser and assembly-independent validator as
config-based `check`. Before assembly, `check-design` proves only these form properties:

- SSF declarations, aliases, and fields parse canonically, including articles,
  multiplicity, `optional`, field-level `unique`, `with`, identifiers, the subset graph,
  and name uniqueness;
  every line either parses or is a `Rule:` line, whose prose stays opaque;
- typed `reaction:`, `view:`, and `former:` links contain exact, non-wildcard dotted
  paths, and `computation:` links contain exact computation names;
- `endpoints` fences contain only `Declaration.Identity at /path` entries with exact
  dotted identities and portable absolute route paths;
- `computations` declarations have valid signatures, distinct input names, balanced
  type delimiters, and indented prose bodies;
- application `types` fences contain only `concrete Name` declarations with prose;
- `instances` fences contain bare, renamed, or inline-bound instance declarations,
  and every `with` has at least one indented local binding;
- `bindings` fences contain only detached `Instance.External is Target` declarations;
- binding targets have concrete-name or qualified `Instance.Type` shape;
- one instance does not mix inline and detached placement within the supplied corpus;
  and
- endpoint identities, computation names, concrete type names, instance names, and
  binding left sides are not duplicated across the supplied application-design
  documents.

Application declaration syntax is:

```text
endpoint             = DeclarationPath "at" PortableAbsoluteRoutePath
concrete-type        = "concrete" Name, indented-nonempty-prose
instance             = "instantiate" Definition ("as" Instance)? ("with" local-bindings)?
local-binding        = External "is" Target
detached-binding     = Instance "." External "is" Target
Target               = Concrete | Instance "." OwnedType
```

`with` requires one or more indented local bindings. Instance, definition,
external, concrete, and owned type names use ASCII letters, digits, and `_`,
beginning with a letter or `_`; they do not use the hyphens permitted in dotted
application declaration paths. Arbitrary prose is not admitted inside
`endpoints`, `instances`, or `bindings` fences.

The command does not discover additional files or require a complete corpus. Its
bounded SSF parser establishes the declaration and owned-name inventory,
not a storage schema or invariant/prose semantics. It does not resolve typed links,
endpoint identities and paths, instance definitions, external names, or binding targets
against an assembled selection. It also does not require complete endpoints, instances,
or declaration coverage,
compare computation inputs with TypeScript, validate concept source agreement, or
inspect ordinary prose and computation-body semantics. Those checks need the selected
assembly and remain the job of config-based `sync-engine check`. In particular, a
detached binding and binding target are accepted by shape even when their instance,
concrete declaration, or target concept is outside the supplied partial corpus;
rejecting them would make partial-corpus checks produce false positives.

`check-design` reads no generated config, assembly, TypeScript project, or Git state and
writes no files.

## `sync-engine verify`

```text
sync-engine verify [--config path] [--fail-on-warnings] [--show-advisories] [--format json]
```

`verify` is a runner, not another validator. It does not invoke Bun scripts, `tsc`, or a test
suite. It reads the generated descriptor selected by `--config` (default
`generated.config.ts`) to obtain its required, ordered `design.documents` local file URLs, then
uses those exact files as the explicit operands of `check-design`. It does not scan directories
or infer design paths. The same descriptor is then passed to the configured commands in this
order:

1. `sync-engine check-design <configured design documents>`;
2. `sync-engine check [--config path]`; and
3. `sync-engine artifacts check [--config path]`.

When the configuration registers no design documents, `check-design` is reported as skipped:
the standalone command requires at least one explicit operand, while an empty registration is
valid for a concept-free application. `--fail-on-warnings` and `--show-advisories` are
passed only to `check`.

After the configuration has loaded, a failed step does not prevent later steps from running.
The checks each have independent useful results: source or diagnostic failures do not make an
artifact mismatch irrelevant. If the configuration itself cannot load, `verify` cannot obtain
safe operands or run either configured command, so it reports all three steps as skipped.

The final report records configuration discovery and marks each step as `passed`, `failed`, or
`skipped`; failure details are retained with their step. It exits successfully only when the
configuration loads and every applicable step passes. `--format json` serializes this same
versioned report directly.

## `sync-engine check`

```text
sync-engine check [--config path] [--fail-on-warnings] [--show-advisories] [--format json]
```

A generated application config is required. Its path defaults to
`generated.config.ts`; `--config path` selects another descriptor. The removed
`--vocabulary-module` option and no-config concept-set compatibility mode are
unsupported.

The config must default-export an application descriptor with an `assemble`
function and a versioned `design` block. The checker assembles the selected
application once and checks the exact variant returned by that descriptor. It
uses assembly-exported instance/definition facts rather than only syntactically
discovered `conceptSet` entries, so advanced `vocabulary(...)` assembly remains
supported. The core-owned `RequestBoundary`, other built-in concepts, and
core-generated reactions are excluded from author-owned completeness and
coverage requirements.

### Concept checks

For each selected application concept, `check`:

- traces the static Markdown import supplying `registerConcept(...).spec`;
- verifies that the source file matches the registered text;
- parses the strict ordered version-1 concept format, rejecting subordinate
  headings and application-only Markdown;
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
TypeScript types or require conventional and refinement names to have Types
declarations. It retains full State text and parses bounded SSF structure to
inventory owned binding targets. It does not interpret `Rule:` prose or compare State
with class fields or storage.

### Application-design checks

For the configured design corpus, `check`:

- accepts only explicit local `file:` URLs;
- parses links, computations, and application `endpoints`, `types`, `instances`, and
  `bindings` fences in every listed document;
- inventories all normalized source contents for provenance and digests;
- requires an exact one-to-one match between authored instances and the assembled
  variant's non-core `(instance, definition)` facts;
- validates application `concrete` declarations, one binding placement per instance,
  and complete external binding closure;
- proves qualified binding targets against the selected definition's SSF-owned names,
  while rejecting external-to-external targets and alias chains;
- resolves every `reaction:`, `view:`, `former:`, and `computation:` link;
- requires every selected endpoint to have exactly one authored endpoint entry whose
  dotted identity and path match the executable declaration;
- requires reaction-link coverage for every selected authored reaction/endpoint tree
  and typed-link coverage for every named view and named former;
- requires exactly one declaration for every executable computation; and
- rejects authored declarations that are absent from the selected assembly.

Every binding edge resolves directly. Cycles among qualified owned-type instance
dependencies are valid; a cycle does not turn an external parameter into a valid
target.

The checker validates links and coverage, not the truth of ordinary prose. It
does not interpret State invariants or prove computation-body semantics.

By default, successful human-readable output reports the advisory count without listing
each warning and informational diagnostic. `--show-advisories` lists them. JSON output
always contains the complete diagnostic array. `--fail-on-warnings` promotes application
warnings and lists the diagnostics responsible for failure without requiring
`--show-advisories`. Errors always fail; informational diagnostics remain advisory. The
command modifies no files.

## Generated application configuration

Every command in this section imports the same generated descriptor. The config
path defaults to `generated.config.ts`.

The required application design block is:

```text
design: {
  version: 1,
  documents: URL[],
}
```

`documents` can be empty only when the assembled variant selects no application
concept instances. Any listed document may contain `types`, `instances`, and
`bindings` fences. Selected instances and external types require complete exact
closure across the registered corpus; `RequestBoundary` is exempt. All URLs must
be local `file:` URLs. A separate assembly variant uses a separate config and is
checked independently.

Configuration source must be statically inspectable where a command needs
source provenance. Import, config, assembly, source, design, and projection
errors occur before artifact comparison or writing.

## `sync-engine artifacts`

```text
sync-engine artifacts <command> [arguments]
```

All artifact commands enforce the complete configured design contract. Runtime
`assemble(...)` alone does not load these documents.

### `check`

```text
sync-engine artifacts check [--config path] [--format json]
```

Renders the complete plan and compares generated Markdown and TypeScript with
their configured paths. Success is silent. A mismatch names affected files and
exits with status 1. No files are rewritten. `--format json` writes the versioned
diagnostic report described above instead of human text.

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

Prints canonical JSON for `sync-engine.application-manifest`, version `1`. This
pre-1.0 beta reset replaces the version-1 schema in place: earlier beta shapes
and prior versions are rejected and have no compatibility decoder.

The manifest retains normalized full concept State text, structured concept
action/query declarations, authored definition/instance identities and bindings, each
definition's exact-spelling SSF-owned type inventory, resolved application types,
application declaration identities, computation signatures, source locations, and
digests over registered design contents. It excludes executable functions,
constructor arguments, floor resources, object identity, occurrence state, and
other runtime-only values.

### `diff`

```text
sync-engine artifacts diff <old-manifest> [--config path]
```

`diff` reads `<old-manifest>` as UTF-8 and decodes it as one complete canonical
`sync-engine.application-manifest`, version `1`, before it imports the selected
configuration. Invalid JSON, a stale digest, an unsupported version, and the
replaced pre-1.0 version-1 shape all fail closed with an error naming the old
manifest. The command does not infer a schema or partially compare an undecodable
file.

The current side is assembled and checked using the selected configuration, just
as `manifest` does. The report keeps the old and current digests, reports
`identical` only when those digests match, and separates the following direct
manifest-inventory changes into breaking and non-breaking lists:

| Change                                                | Classification                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Removed endpoint                                      | Breaking                                                             |
| Added endpoint at a path absent from the old manifest | Non-breaking                                                         |
| Added endpoint at an existing path                    | Breaking, because it can add a competing answer branch               |
| Added required input key                              | Breaking                                                             |
| Removed required input key                            | Non-breaking                                                         |
| Added, removed, or changed input default              | Breaking, because an omitted key reaches the application differently |
| Added or removed refusal code                         | Breaking; either changes a caller-facing error union                 |
| Added owned type                                      | Non-breaking                                                         |
| Removed owned type                                    | Breaking                                                             |

Endpoints are identified by their manifest name and path. For input contracts at
paths present on both sides, the report names each required key and each default
key; a changed object or array default is one whole-value change rather than a
deep value diff. Refusal codes are identified by concept, action, and code; owned
types by definition and exact SSF spelling. Endpoint additions and removals carry
their input contracts with them and do not produce a redundant contract entry.

The comparison intentionally does not interpret `application` IR, reaction
behavior, diagnostics, or prose. If the complete manifest digest changes without
a listed inventory change, the report says so without guessing why. A zero exit
status means no listed breaking change; a non-empty breaking list exits with
status `1`, so `diff` can serve as a compatibility gate.

### `spec`

Prints generated Markdown read-back. It shows:

- reaction and endpoint lowering with each authored tree's stable identity;
- named view and former definitions;
- all source locations that cover each selected declaration;
- structured concept signatures, cardinalities, refusals, definition names,
  authored instances and binding source links;
- concrete types and resolved external bindings; and
- computation signatures and source links.

It does not copy application prose, Purpose, Principle, full State text,
action/query bodies, adjacent binding explanations, or computation bodies.
Concept State remains in the manifest and digest even though the State body is omitted
from read-back.

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
incomplete design coverage, application-type errors, projection errors, and strict
wire-provenance failures reject the complete plan.

After inspection, the command drains the assembly. A descriptor may provide a
`close()` callback for generation-only resources; it runs after drain, including
when inspection or rendering fails. This callback does not transfer ownership
of ordinary concept-floor or store resources to assembly.

Treat `pin`, `pin-spec`, and `pin-wire` as source-changing operations. Review
their diffs and run `sync-engine artifacts check` in continuous integration.
