# Concept specification processing

This document maps how this checkout extracts and uses machine-readable facts
from `spec.md`, including enforcement gaps. The supported [concept specification
format](../user/reference/concept-specification.md) remains the consumer contract;
[engine architecture](architecture.md) defines surrounding boundaries.

## Contract boundary

| Source                                        | Establishes                                              |
| --------------------------------------------- | -------------------------------------------------------- |
| Consumer reference and public declarations    | Behavior consumers may rely on                           |
| Implementation files named below              | What this checkout does, including accidental behavior   |
| Focused tests and `bun run check`             | Cases the repository currently verifies                  |
| [Extension directions](#extension-directions) | Options only; no implementation or compatibility promise |

The engine does not infer schemas or behavior from human-readable Markdown.
[Known gaps](#known-gaps) records enforcement differences.

## Processing pipeline

| Stage         | Owner                                                     | Current effect                                                                          |
| ------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Parse         | `src/engine/reactions/concepts/concept-spec.ts`           | Convert Markdown text to versioned `ConceptSpec`                                        |
| Register      | `src/engine/boundary/assembly/concept-set.ts`             | Compare declarations with the class and validate refusal mappings                       |
| Project       | `conceptSet` in the same file                             | Carry the parsed contract plus runtime query/refusal contracts into metadata            |
| Source-check  | `src/command/check.ts`                                    | Compare declarations with supported TypeScript source forms                             |
| Attach        | `src/engine/boundary/assembly/assemble.ts`                | Attach vocabulary metadata to selected instances                                        |
| Execute reads | `src/engine/reads/queries.ts`                             | Enforce query answer containers and cardinality during reaction, view, and former reads |
| Inspect       | `src/engine/reactions/concepts/introspect.ts` and tooling | Emit the parsed contract in inventories, manifests, and read-back                       |

Registration recovers some runtime parameter names; source checking reads class
declarations and catches forms erased from JavaScript. Query enforcement applies
to instrumented reads, not every direct method call. The lower-level
`vocabulary({ class, spec })` path differs from `registerConcept`; see
[Vocabulary-only parsing](#vocabulary-only-parsing).

## Parser behavior

`parseSpec(markdown)` is a purpose-built Markdown section scanner and
declaration parser, not a general Markdown parser. It returns these top-level
fields:

| Field            | Retained data                                                                          |
| ---------------- | -------------------------------------------------------------------------------------- |
| `format/version` | `sync-engine.concept-specification` version 1                                          |
| `purpose`        | Trimmed text from the unique nonempty `## Purpose` section                             |
| `principle`      | Trimmed text from the unique nonempty `## Principle` section                           |
| `actions`        | Structured parameters/result, body, refusals, compatibility input names, and locations |
| `queries`        | Structured parameters/result, body, promise, compatibility input names, and locations  |
| `documentation`  | Ordered Types and extension sections with Markdown bodies and locations                |

Type expressions are an implementation-language-independent tree of named
references, generic arguments, unions, `null`, and `undefined`. Results are
inline fields or a type expression. `ConceptSpec` has no State descriptor or
executable action behavior tree. Parsing has no explicit document-size or
declaration-count limit and retains the string and complete line array.

### Sections and fences

`sectionsOf` recognizes second-level headings outside backtick or tilde fences.
Heading indentation is accepted; spelling, case, and level are otherwise exact.
Purpose and Principle are required, nonempty, and unique. Actions and Queries
are optional but unique when present. Duplicate State sections are not checked
because State is not parsed.

`fenceOf` finds an `actions` fence only inside `## Actions` and a `queries`
fence only inside `## Queries`. A declaration fence in an example, State, or an
unrelated section is ignored. A second matching fence or an unterminated
matching fence fails with its location.

`documentationOf` retains `## Types` as a typed documentation block and every
other non-reserved second-level section as an extension block. Purpose,
Principle, State, Actions, and Queries are reserved. Documentation blocks retain
authored order and have no registration semantics.

Within a selected fence, each nonempty left-aligned line starts a declaration.
Indented lines belong to the preceding declaration; an indented line before a
signature fails. Actions and queries retain normalized bodies with outer blank
lines and common indentation removed.

### Signatures and refusals

`SignatureParser` consumes the complete declaration line. Its balanced grammar
parses comma-separated fields, optional markers, qualified named types, nested
generic arguments, parenthesized types, unions, `null`, and `undefined`. It
retains structured input and result declarations plus a compatibility `inputs`
name list. Duplicate fields, missing types or results, and trailing text fail at
the source line and column.

Action names match `[A-Za-z][A-Za-z0-9_]*` and resolve with `return`. Query
names match `_[A-Za-z0-9_]*` and resolve with `one`, `optional`, or `many`; `_`
alone is therefore a valid query name. Names must be unique within their
declaration fence.

Action body lines beginning with the literal text `refuse ` must match a code
followed by a JSON-compatible quoted string. Messages are decoded, must be
nonempty, and may contain escaped quotes. One action cannot repeat a code;
several actions may use the same code.

Parsed types, outputs, rows, and bodies are documentation, not runtime schemas or
behavior. The parser does not interpret `where`, `then`, `return`, state changes,
ordering, or other prose.

## Enforcement stages

### `registerConcept`

`registerConcept` inventories callable own and inherited prototype methods up
to, but excluding, `Object.prototype`. Underscore-prefixed methods are queries;
other methods are actions. Accessors and non-function properties are excluded.

Registration enforces:

- action and query membership in both directions;
- input-name equality, disregarding order, when runtime function text exposes a
  nonempty top-level destructured parameter;
- one registered `Error` subclass for every parsed refusal code;
- no extra refusal mapping; and
- a distinct `Error` class for each refusal code.

Placeholder, plain, absent, empty, or unsupported destructured parameters skip
runtime input comparison. Registration does not inspect returns, outputs, State,
action behavior, fields, or storage.

`conceptSet` retains the parsed specification in metadata. Refusals become
action-specific triples of code, normative specification message, and
registered `Error` class. Query promises become a map keyed by query name.

### Vocabulary-only parsing

`specifiedContracts` in `src/engine/reactions/authoring/refs.ts` retains the
parsed contract and derives Purpose, Principle, and query promises from a
`{ class, spec }` descriptor. It cannot derive refusal contracts, which require
registered Error classes. Explicit descriptor metadata can override parsed
metadata. This path omits `registerConcept` conformance checks.

### `sync-engine check`

The command discovers `spec.md`, reads the neighboring `registry.ts`, and finds
the class identifier passed to `registerConcept`. That identifier must be a
named import whose local name matches a class declared directly in the target
file. The checker resolves the import path relative to the registry without
TypeScript module resolution, support for aliased imports, or re-export
traversal.
It compares direct, non-static, non-TypeScript-`private` methods with parsed
action/query names.

`checkerFor` loads the nearest `tsconfig.json`, preserving compiler options,
module resolution, paths, and project references. Config-included concepts share
a cached Program; an excluded concept source is added explicitly. Without a
config, one NodeNext Program starts from the class source. Registry-to-class
discovery remains syntactic and direct, but parameter type imports and
re-exports use normal TypeScript resolution.

For inputs, the checker supports no parameter, one flat untyped destructuring,
or one typed parameter whose semantic type resolves to a finite object key set.
The TypeChecker naturally resolves local and imported aliases, interfaces and
extension, qualified names, re-exports, utility and equivalent mapped types, and
finite records. Resolution distributes unions and intersections as key-set
alternatives. An intersection combines each possible set; a union is accepted
only when every final alternative has the same keys.

Resolution is cycle-safe and bounded to an expansion depth of 32 and 64
generated alternatives. It fails closed for differing alternatives, open index
signatures, unresolved or generic mapped shapes, `any`, `unknown`, primitives,
arrays, callables, and invalid parameter lists. `Record<string, never>`
contributes no keys, while `Record<"known", never>` contributes its finite key.

Diagnostics retain the parameter type, first unsupported operation, declaration
location, relevant TypeScript diagnostic, and differing key sets.

The checker does not traverse base classes. Runtime registration can therefore
accept an inherited member that the source checker rejects.
`scripts/check-specs.ts` checks examples, catalog concept entries, and the
packed application fixture. The installed command defaults to `src/concepts`;
an existing root with no concepts is valid for the concept-free setup
application.

### Runtime and tooling

Purpose and Principle are descriptive inventory metadata, not assertions.
Refusal metadata maps a registered exception on its declared action to the
specification code and message. Ordinary assembly treats undeclared advanced
`Refuse` codes as faults; manual `createEngine` may accept them. Refusal mappings
are action-specific: another action throwing the same `Error` class faults unless
it declares the code.

Query promises are attached to vocabulary references and instrumented query
wrappers. `queryRows` enforces them when reactions, views, or formers evaluate a
query:

| Promise    | Required result                            |
| ---------- | ------------------------------------------ |
| `one`      | One non-null, non-array object             |
| `optional` | An array containing zero or one object row |
| `many`     | An array containing object rows            |

A direct instrumented query call returns the implementation result without
passing through `queryRows`; the promise is not checked on that path.

TypeScript class signatures, not Markdown types or results, drive authoring types
and wire provenance.

`ConceptInventoryIR.specification` is optional, so concepts declared without a
specification retain the narrower inventory. Registered concepts carry the
version-1 JSON-safe contract. Manifest canonicalization sorts
runtime inventory members but preserves authored contract arrays, including
documentation order. The Markdown renderer prefers the authored contract and
falls back to the narrow legacy inventory when none is present. Generated
provenance identifies the manifest producer, specification format, and renderer.

## Deliberately uninterpreted material

The current design leaves these properties to principle, implementation, and
backend tests:

- runtime validation of action outputs and query rows;
- resolution of type names and runtime input schemas;
- State shape, relationships, multiplicity, and invariants;
- action conditions, effects, and operation order;
- query purity; and
- persistence, transaction, concurrency, and durability behavior.

Purpose, Principle, and action bodies are design evidence, not proof of
implementation behavior.

## Known gaps

| Current behavior                                        | Consequence                                           |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Named specification types are not resolved              | Parsed references do not prove a declaration exists   |
| Runtime role recovery reads function text               | Runtime registration can skip an erased comparison    |
| Registration sees inheritance; source checking does not | The two checks can disagree on inherited members      |
| Direct query roots bypass `queryRows`                   | Cardinality enforcement depends on the call path      |
| Parsed action bodies are not interpreted                | Conditions and effects require implementation tests   |
| State has no parsed representation                      | State claims require implementation and backend tests |

## Verification ownership

| Test                                            | Primary evidence                               |
| ----------------------------------------------- | ---------------------------------------------- |
| `tests/internal/reactions/concept-spec.test.ts` | Parser output and basic grammar failures       |
| `tests/internal/boundary/concept-set.test.ts`   | Registration, refusal metadata, and projection |
| `tests/internal/tooling/check-specs.test.ts`    | TypeScript source forms and repository roots   |
| `tests/internal/reads/query-answers.test.ts`    | Read-path query normalization and cardinality  |

After changing parsing, registration, source checking, or the format, run
`bun run check`. Add focused tests for each newly accepted or rejected form.

## Extension directions

| Direction                                            | Enables                                                        | Does not establish                              | Main decision or cost                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Make direct-query cardinality consistent             | One promise rule across direct and evaluated reads             | Row-field validation                            | Failure timing changes and must account for caching, admission, and row limits |
| Add a backend-neutral state descriptor when required | Let participating adapters validate shared logical constraints | Automatic persistence or transaction guarantees | Define adapter capabilities, migrations, and unsupported constraints           |

Do not turn natural-language behavior or parsed result declarations into
runtime guarantees implicitly. Any future enforcement or State descriptor needs
an explicit, versioned consumer contract with projection, serialization,
compatibility, and tests at every downstream stage.
