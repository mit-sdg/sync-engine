# Concept specification format

A concept specification is the reusable, concept-local contract passed as
Markdown text to `registerConcept`. It has a strict section order and a
TypeScript-independent version-1 representation. The specification defines a
concept definition; an application may instantiate that definition more than
once under different concept-set keys.

Application composition, concrete application types, typed design links, and
computations do not belong in a concept specification. They belong in
[registered application design](../guide/authoring.md#6-register-explicit-design-urls).

For a new application, put one definition per
`design/concepts/DefinitionName.md`. This is the recommended authoring layout, not a
path restriction: registration follows the statically resolvable Markdown import.
Before implementation exists, parse explicit draft files with:

```sh
sync-engine check-concepts design/concepts/*.md
```

This command loads no application configuration or TypeScript source, writes nothing,
and reports only concept grammar failures. Config-based `sync-engine check` adds
registration provenance and TypeScript agreement after implementation.

## Document grammar

A specification has exactly one H1 followed by exactly these H2 sections, once
each and in this order:

```text
# DefinitionName

## Purpose
## Principle
## Types
## State
## Actions
## Queries
```

The H1 is the concept-definition name, not an application instance name.
Unknown, missing, reordered, or duplicate H2 sections are rejected. Subsection
headings are also rejected: the six H2 sections are the complete document
outline. `Purpose` and `Principle` must contain nonempty prose and no fenced
blocks.

`Types`, `Actions`, and `Queries` contain only their one matching fence and no
surrounding Markdown. `State` contains one `state` fence and may have concise
prose after it for invariants that the notation cannot express. Application
design links and `computations` fences are rejected anywhere in a concept
specification.

## Complete example

````md
# Noting

## Purpose

Keep short notes for later retrieval.

## Principle

A person writes a note and reads it by its identifier. After the person
discards the note, another discard is refused because the note no longer
exists.

## Types

```types
external Person
  The person who authors a note.
```

## State

```state
notes: set Note
  author: Person
  text: String
```

## Actions

```actions
write(author: Person, text: String) : return (note: Note)
  where true
  then
    add a new note with author and text
    return note

discard(note: Note) : return (note: Note)
  where note exists
  then
    remove note
    return note
  where note does not exist
  then
    refuse NOTE_NOT_FOUND "There is no such note."
```

## Queries

```queries
_get(note: Note) : optional (author: Person, text: String)
  Returns no row when the note does not exist.
```
````

## `Types`

`Types` contains exactly one `types` fence. The fence may be empty. Version 1
accepts only external declarations:

```types
external User
  The person who authors a comment.

external Target
  The object receiving the comment.
```

The declaration grammar is:

```text
external Name
  optional explanation, which may continue on later indented lines
```

An external type is an opaque parameter supplied by each application that uses
the concept. The explanation is retained as documentation. The `external`
keyword is required; concrete types and bindings are application design,
not concept-local declarations.

Other names in State, action signatures, and query signatures are descriptive
vocabulary, not declarations that must be repeated in Types. A name may identify
concept-owned state, a conventional value such as `String` or `Flag`, or a
refinement whose accepted values are established by action conditions and
refusals. Version 1 parses type-expression shape but neither defines a primitive
type universe nor requires every named type to have a declaration.

## `State`

`State` contains exactly one `state` fence. The parser normalizes and retains
the fence contents verbatim in concept-specification IR and application
manifests. Version 1 does not parse or validate those contents.

The intended notation is Simple State Form (SSF), based on the
[conceptbox state-language proposal](https://github.com/61040-fa25/conceptbox/raw/refs/heads/main/design/background/detailed/concept-state.md).
Its grammar remains deferred. Version 1 therefore does not implement a partial
parser, scan type names heuristically, or define a private SSF dialect.

Because State is unparsed, tooling does not yet prove:

- that action and query types are state-owned or external;
- that every external type is used; or
- that a qualified type-binding target is introduced by the target concept's
  State.

The checker still inventories external declarations and checks every required
application type binding. State changes affect canonical design digests
even before SSF parsing is available.

## `Actions`

`Actions` contains exactly one `actions` fence and declares at least one action.
Each action has this shape:

```text
actionName(input: Type, optional?: Type) : return (result: Type)
  where condition prose
  then
    effect prose
    return result
```

The exact requirements are:

- the signature has parenthesized named input fields;
- `: return` is followed by parenthesized named result fields;
- one or more explicit `where`/`then` branches follow the signature;
- an unconditional branch uses `where true`;
- each `then` block ends with exactly one `return ...` or
  `refuse CODE "Normative sentence."` line; and
- bare result types are rejected.

An empty successful result is written as `()` and terminates with plain
`return`. For a nonempty result, every successful branch returns exactly the
signature's result names, irrespective of order.

A refusal code may occur only in the action that declares it. The sentence is
the normative caller-facing detail and supports JSON string escapes.
`registerConcept` requires the existing one-to-one mapping between refusal codes
and distinct `Error` classes and rejects extra mappings.

Conditions and effects are controlled prose. The parser checks branch and
terminal shape but does not prove their meaning or execute them.

## `Queries`

`Queries` contains exactly one `queries` fence. The fence may be empty. A query
has this signature:

```text
_query(input: Type) : one (field: Type)
_query(input: Type) : optional (field: Type)
_query(input: Type) : many (field: Type)
```

Input and result fields are parenthesized and named. Bare result types are
rejected. The optional indented body is arbitrary prose; no word such as
`answers` or `orders` is required. Omit the body when State and the signature
already determine the answer.

The cardinalities retain their runtime meaning:

| Choice     | Required evaluated result                     |
| ---------- | --------------------------------------------- |
| `one`      | Exactly one non-null, non-array object        |
| `optional` | An array containing zero or one object row    |
| `many`     | An array containing any number of object rows |

Reactions, views, and formers enforce this container/cardinality contract when
they evaluate a query. A query body remains a design statement rather than an
executable assertion.

## Names and type expressions

Action names begin with an ASCII letter. Query names begin with `_`. Field
names begin with an ASCII letter or `_`; subsequent characters may also be
digits. Names must be unique in their applicable scope.

Type expressions remain implementation-language-independent references. They
do not establish runtime schemas or semantic equivalence with TypeScript types.
In particular, a concept identity commonly erases to `string` in an
implementation.

## Agreement with TypeScript

Config-based `sync-engine check` compares selected concept declarations with
resolved TypeScript source. It checks:

- action and query member names;
- input field names and optionality;
- action-result field names and optionality;
- query-row field names and optionality;
- registered refusal mappings; and
- query cardinality through the existing runtime read checks.

For optionality, `field?: T` and `field: T | undefined` are equivalent. Static
checking fails closed when it cannot resolve an input, action-result, or query-row
shape. It does not claim semantic type-name equivalence or State/storage
agreement.

Each successful action branch's terminal return names are checked against the
declared result fields. Conditions, effects, query-body meaning, persistence,
transactions, and durability remain implementation and test responsibilities.

## Definition and instance identity

One registration can be installed under several application names:

```text
conceptSet({
  PostComments: commenting,
  AnswerComments: commenting,
})
```

Both instances use the `Commenting` definition. Generated design output records
the definition name and each instance name separately. If selected
registrations use the same definition name, their canonical specifications must
be identical. Different implementation classes or floors may implement that
shared contract; incompatible specifications cannot claim the same definition
name.

## Source provenance

`registerConcept` continues to receive imported Markdown text:

```text
import spec from "@design/concepts/Commenting.md" with { type: "text" };
registerConcept({ class: Commenting, spec });
```

Strict config-based checking traces the import that supplies `spec`, verifies
that its file contents match the registered text, and records the source path.
Dynamic or unresolvable specification construction fails the check. The
registration API does not accept a duplicate source URL. The source path and
filename have no effect on the contract; the authoring guide recommends a
consistent design-first layout without making it a checker requirement.

The IR format remains `sync-engine.concept-specification`, version `1`. This is
an intentional beta redefinition: legacy concept specifications are not parsed
or auto-detected.

## Author obligations

Write the concept contract before its implementation and run `sync-engine
check-concepts` over the draft. Keep the concept independent of application
composition, place every local invariant in its owning action and State description,
and test behavior and storage guarantees separately. Then register the imported text,
select the registration in a `conceptSet`, and run `sync-engine check` against the
application's generated config.

See [Application authoring](../guide/authoring.md) for the complete workflow and
[Command-line reference](cli.md#sync-engine-check) for command behavior.
