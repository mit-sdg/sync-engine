# Concept specification processing

This project document describes how the current implementation extracts and
uses machine-readable facts from `spec.md`. It is a maintainer map, not a
replacement for the supported consumer [Concept specification
format](../user/reference/concept-specification.md). See [Engine
architecture](architecture.md) for the surrounding subsystem boundaries.

## Contract boundary

Keep these sources of truth distinct when changing this path:

| Source                                        | Establishes                                              |
| --------------------------------------------- | -------------------------------------------------------- |
| Consumer reference and public declarations    | Behavior consumers may rely on                           |
| Implementation files named below              | What this checkout does, including accidental behavior   |
| Focused tests and `bun run check`             | Cases the repository currently verifies                  |
| [Extension directions](#extension-directions) | Options only; no implementation or compatibility promise |

The supported format uses Markdown for both machine declarations and human
explanation. The engine does not infer schemas or behavior from the human
parts. The current parser is more permissive than the intended format in
several places; [Known gaps](#known-gaps) records those cases separately.

## Processing pipeline

| Stage         | Owner                                                     | Current effect                                                                           |
| ------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Parse         | `src/engine/reactions/concepts/concept-spec.ts`           | Convert Markdown text to `ConceptSpec`                                                   |
| Register      | `src/engine/boundary/assembly/concept-set.ts`             | Compare declarations with the class and validate refusal mappings                        |
| Project       | `conceptSet` in the same file                             | Carry purpose, principle, query promises, and refusal contracts into vocabulary metadata |
| Source-check  | `src/command/check.ts`                                    | Compare declarations with supported TypeScript source forms                              |
| Attach        | `src/engine/boundary/assembly/assemble.ts`                | Attach vocabulary metadata to selected instances                                         |
| Execute reads | `src/engine/reads/queries.ts`                             | Enforce query answer containers and cardinality during reaction, view, and former reads  |
| Inspect       | `src/engine/reactions/concepts/introspect.ts` and tooling | Emit retained metadata in inventories, manifests, and read-back                          |

The lower-level `vocabulary({ class, spec })` path also parses a specification,
but it is not equivalent to `registerConcept`; see [Vocabulary-only
parsing](#vocabulary-only-parsing).

## Parser behavior

`parseSpec(markdown)` is a line-and-regular-expression parser, not a Markdown
parser. It returns exactly these fields:

| Field       | Retained data                                                     |
| ----------- | ----------------------------------------------------------------- |
| `purpose`   | Trimmed text from the first nonempty `## Purpose` section         |
| `principle` | Trimmed text from the first nonempty `## Principle` section       |
| `actions`   | Action name, input names, and refusal code/message pairs          |
| `queries`   | Query name, input names, and `one`, `optional`, or `many` promise |

`ConceptSpec` retains no source locations, type descriptors, output
descriptors, State descriptor, or action behavior tree.

The parser has no explicit document-size or declaration-count limit. It holds
the supplied string and its complete line array while parsing.

### Sections and fences

`sectionOf` finds the first line whose trimmed text is exactly `## Purpose` or
`## Principle`. The section ends at the next trimmed line beginning with
`## `. Heading indentation is accepted; spelling, case, and level are otherwise
exact. The search does not account for fenced-code context.

`fenceOf` searches the entire document for the first trimmed line composed of
three backticks followed by `actions` or `queries`. The block ends at the next
trimmed line beginning with three backticks. Fence discovery is not scoped to
an `Actions` or `Queries` section. An absent fence declares no members; an
unterminated fence fails. Duplicate, misplaced, and later fences are not
rejected.

There is no State parser, and `ConceptSpec` has no State field. Document-global
discovery still applies inside State text and `state` fences, however. A
reserved Purpose or Principle heading can participate in section discovery,
and an `actions` or `queries` fence is parsed. This is an implementation defect,
not a supported declaration form.

Within a selected fence, each nonempty left-aligned line starts a declaration.
Indented lines belong to the preceding declaration; an indented line before a
signature fails. Blank lines are discarded. Actions may have body lines;
queries may not.

### Signatures and refusals

Both declaration kinds use this prefix expression:

```text
^(\S+)\s*\(([^)]*)\)\s*:\s*(\S+)
```

The expression is not anchored at the end. It reads a name, text through the
first `)`, and one resolution token. Action names are ASCII-style identifiers
without a leading `_` and must resolve with `return`. Query names begin with
`_` and resolve with `one`, `optional`, or `many`. Names must be unique within
their selected fence.

Inputs are split at every comma. For each item, the parser retains the trimmed
text before the first colon and requires that text to be an identifier. It does
not require a type, validate type text, or reject duplicate input names. A type
containing a comma is therefore unsupported.

Each trimmed action-body line is independently matched against:

```text
^refuse\s+(\S+)\s+"([^"]*)"$
```

The code may be any non-whitespace token. The message must be nonempty after
trimming and cannot contain a double quote. One action cannot repeat a code;
several actions may use the same code. A refusal-like line that does not match
is silently retained as ordinary prose.

The parser does not validate output clauses or trailing signature text. It does
not interpret type names, `where`, `then`, `return`, state changes, ordering, or
other action-body text.

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
the runtime input comparison. Registration does not inspect return values,
output declarations, State, action behavior, class fields, or storage.

`conceptSet` converts the parsed data into metadata. Refusals become
action-specific triples of code, normative specification message, and
registered `Error` class. Query promises become a map keyed by query name.

### Vocabulary-only parsing

`specifiedContracts` in `src/engine/reactions/authoring/refs.ts` parses only
Purpose, Principle, and query promises from a `{ class, spec }` vocabulary
descriptor. It does not derive action membership or refusal branches. Explicit
descriptor metadata is spread after parsed metadata and can override it. This
path does not perform `registerConcept` conformance checks.

### `sync-engine check`

The command discovers `spec.md`, reads the neighboring `registry.ts`, finds a
`registerConcept` class supplied by a direct named import, and resolves that
import relative to the registry. The target file must directly declare the
class. The checker compares direct, non-static, non-TypeScript-`private` methods
with parsed action/query names.

For inputs, the checker supports no parameter; one untyped object-destructured
parameter without unsupported nested or rest bindings; one inline object type
containing identifier-named properties; `Record<..., never>`; or one direct
same-file alias to a supported typed form. Unsupported syntax fails closed.
Interfaces, imports, qualified types, alias chains, intersections, unions,
mapped or utility types, multiple parameters, and plain untyped parameters are
not resolved.

The checker does not traverse base classes, re-exports, or general TypeScript
module resolution. Runtime registration can therefore accept an inherited
member that the source checker rejects. `scripts/check-specs.ts` checks
`examples` and `tests/package/application`; the installed command defaults to
`src/concepts`. The repository wrapper does not check the scaffold template.

### Runtime and tooling

Purpose and Principle become descriptive inventory metadata, not executable
assertions. Refusal metadata makes a registered exception on its declared
action produce the specification code and message. Ordinary assembly rejects
an undeclared advanced `Refuse` as a fault; manual `createEngine` remains open
to undeclared `Refuse` codes.

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

TypeScript class signatures, not Markdown type or output text, drive authoring
types and wire provenance. Parsing additional Markdown fields would not by
itself change those type sources.

## Deliberately uninterpreted material

The current design leaves these properties to principle, implementation, and
backend tests:

- action outputs and query row fields;
- type names and runtime input schemas;
- State shape, relationships, multiplicity, and invariants;
- action conditions, effects, and operation order;
- query purity; and
- persistence, transaction, concurrency, and durability behavior.

Natural-language Purpose, Principle, and action bodies remain useful design
evidence, but registration does not prove that the implementation satisfies
them.

## Known gaps

| Current behavior                                        | Consequence                                                                       |
| ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Fence lookup is global and first-match-only             | A reserved fence outside its intended section is parsed; later fences are ignored |
| Signature matching accepts a prefix                     | Missing outputs and trailing garbage can pass                                     |
| Input parsing is textual                                | Types containing commas misparse; missing types and duplicate names pass          |
| Refusal-like typos become prose                         | An intended branch may produce no contract or diagnostic                          |
| `ConceptSpec` has no source spans                       | Downstream errors cannot point to exact declaration columns                       |
| Runtime role recovery reads function text               | Some erased parameter forms skip input comparison                                 |
| Registration sees inheritance; source checking does not | The two checks can disagree                                                       |
| Direct query roots bypass `queryRows`                   | Cardinality enforcement depends on the call path                                  |

## Verification ownership

| Test                                            | Primary evidence                               |
| ----------------------------------------------- | ---------------------------------------------- |
| `tests/internal/reactions/concept-spec.test.ts` | Parser output and basic grammar failures       |
| `tests/internal/boundary/concept-set.test.ts`   | Registration, refusal metadata, and projection |
| `tests/internal/tooling/check-specs.test.ts`    | TypeScript source forms and repository roots   |
| `tests/internal/reads/query-answers.test.ts`    | Read-path query normalization and cardinality  |

Run `bun run check` after changing parsing, registration, source checking, or
the documented format. Add focused tests for every newly accepted or rejected
form; the current tests do not exhaust the gaps above.

## Extension directions

| Direction                                            | Enables                                                                                                        | Does not establish                                 | Main decision or cost                                                          |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Harden grammar and section scoping first             | Reject misplaced or duplicate fences, malformed signatures, duplicate inputs, and refusal typos with locations | Output or state validation                         | Permissive inputs may exist; define compatibility and migration diagnostics    |
| Parse explicit output descriptors                    | Better inventories and optional comparison with selected tooling contracts                                     | Runtime value validation or trustworthy wire types | Define grammar, unions, async results, TypeScript bridging, and versioning     |
| Make direct-query cardinality consistent             | One promise rule across direct and evaluated reads                                                             | Row-field validation                               | Failure timing changes and must account for caching, admission, and row limits |
| Use a TypeScript program in the source checker       | Resolve inheritance, imports, interfaces, aliases, and richer types                                            | Behavioral verification                            | Own tsconfig selection, module resolution, diagnostics, and performance        |
| Add a backend-neutral state descriptor when required | Let participating adapters validate shared logical constraints                                                 | Automatic persistence or transaction guarantees    | Define adapter capabilities, migrations, and unsupported constraints           |

Do not parse natural-language behavior into runtime guarantees. If output or
state data becomes machine-readable, introduce a versioned consumer contract
and account for its projection, serialization, compatibility, and tests at
every downstream stage.
