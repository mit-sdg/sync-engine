# Concept specification format

A concept specification is Markdown text, normally `spec.md`, passed to
`registerConcept`. The parser produces a TypeScript-independent `ConceptSpec`
containing purpose, principle, action and query declarations, refusals,
documentation, and source locations.

Registration checks members, recoverable input names, and refusals.
`sync-engine check` compares declarations with class source. Reactions, views,
and formers enforce registered query cardinalities. Prose, types, results, and
State notation are not runtime schemas or executable behavior.

## Complete example

This document declares two actions, one optional query, and one refusal:

````md
# Noting

## Purpose

Keep short notes for later retrieval.

## Principle

Ada writes a note and reads it by its identifier. After Ada discards the note,
another discard is refused because the note no longer exists.

## Actions

```actions
write (text: String) : return (note: Note)
  then
    save text
    return note

discard (note: Note) : return (note: Note)
  where note not in notes
  then
    refuse NOTE_NOT_FOUND "There is no such note."
  where note in notes
  then
    delete note
    return note
```

## Queries

```queries
_get (note: Note) : optional (text: String)
  answers no row for an unknown Note
```
````

| Layer                              | Establishes                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Specification parser               | Accepted declaration syntax, descriptions, promises, refusals, and locations   |
| `registerConcept`                  | Agreement with callable methods, recoverable input names, and refusal mappings |
| `sync-engine check`                | Agreement with direct class methods and supported TypeScript input shapes      |
| Engine-evaluated reads             | Query result container and declared cardinality                                |
| Principle and implementation tests | Behavioral sequence, state changes, returned values, and invariants            |

## Required sections

The document must contain non-empty `Purpose` and `Principle` sections. The
parser trims each line before comparing it with these exact heading strings, so
leading whitespace is accepted even when a Markdown renderer would treat that
line differently:

```md
## Purpose

State why this behavior exists.

## Principle

Describe one concrete sequence that demonstrates the behavior.
```

The parser includes all text after each heading up to the next second-level
heading outside fenced code. Heading text, capitalization, and level are
significant. Duplicate `Purpose`, `Principle`, `Actions`, and `Queries` sections
are rejected. A duplicate `State` section is not rejected because State is not
parsed.

An `actions` fence is recognized only within `## Actions`, and a `queries` fence
only within `## Queries`. Fences may use at least three backticks or tildes; the
closing fence must use the same character, contain at least as many characters,
and have no trailing text. A declaration fence in an example, State notation,
or any other section cannot replace the declaration block. More than one
matching fence in a section is rejected.

Within each declaration fence, every member name must be unique. An indented
declaration body must follow a left-aligned signature; a body before the first
signature is rejected. Blank body lines are retained after outer blank lines
and common indentation are removed.

## Signature grammar

Action and query signatures use the following independent grammar:

```text
action       = action-name "(" fields? ")" ":" "return" result
query        = query-name "(" fields? ")" ":" promise result
fields       = field ("," field)*
field        = identifier "?"? ":" type
result       = "(" fields? ")" | type
promise      = "one" | "optional" | "many"
type         = named-type | "null" | "undefined" | "(" type ")" | type "|" type
named-type   = qualified-name ("<" type ("," type)* ">")?
identifier   = (ASCII letter | "_") (ASCII letter | digit | "_")*
action-name  = ASCII letter (ASCII letter | digit | "_")*
query-name   = "_" (ASCII letter | digit | "_")*
```

A qualified type name joins `identifier` values with dots. An action name cannot
begin with `_`; a query name may be `_` alone. Commas inside generic arguments
and delimiters inside parenthesized types do not split the surrounding field
list. The parser retains field names, optionality, type structure, result
structure, and one-based source locations. It does not resolve a type name against TypeScript or validate values
at runtime.

## Documentation sections

`## Types` and other non-reserved second-level sections are ordered documentation
blocks with nonempty Markdown bodies. Their bodies and source locations survive
in `ConceptSpec`, application manifests, and generated read-back but have no
registration or runtime semantics. `Purpose`, `Principle`, `State`, `Actions`,
and `Queries` are reserved; State is excluded.

## Writing conventions

The parser does not enforce these conventions. Apply them during [design
review](../guide/reviewing-a-design.md#2-review-each-concept). A specification
must stand alone: declarations state every observable rule, without relying on
the implementation class or nearby prose.

**Let the notation carry the invariant.** Do not repeat guarantees already stated
by the state fence, `where` branches, or query bodies.

| Invariant                       | Where it is already stated                            |
| ------------------------------- | ----------------------------------------------------- |
| A limit or accepted format      | The `where` branch that refuses the values outside it |
| Uniqueness                      | The `where` branch that refuses the duplicate         |
| Ordering                        | A `seq` in the fence and the query's `answers` line   |
| Absence for an unknown input    | The query's `answers` line                            |
| A lifetime, delay, or threshold | The `then` line of the action that sets it            |
| Permanence or no reversal       | No declared transition removes the entity             |
| An unrestricted input           | The action declares no `where` branch that rejects it |

Do not repeat these statements in prose. Use prose only for facts that the
declarations cannot express.

**State the value, not a label for the value.** Write `where content is blank or
longer than 500 characters`, not `where content is longer than the accepted
message bound`. Write `expiring 30 minutes from now`, not `with a bounded
expiry`. A declaration that names but does not state a bound forces the reader
to find the value elsewhere.

**Make each refusal sentence match its action condition.** The sentence is the
caller-visible contract and the registered detail. `"Post content must contain 1
to 500 non-whitespace characters."` does not match a rule that rejects blank
content or content longer than 500 characters.

**Declare the row a query actually returns.** The engine checks a query's result
container and cardinality, but not its fields. An implementation can therefore
return fields omitted by the declaration. Project the result to the declared
fields instead of widening the declaration to expose a convenient internal
record.

**Describe the concept, not one implementation.** Storage choices, process
lifetime, and qualifications such as "in this small implementation" belong in
the application documentation.

### Where each statement belongs

| Statement                                                                            | Section                   |
| ------------------------------------------------------------------------------------ | ------------------------- |
| Why the concept exists and what its absence would cost                               | `Purpose`                 |
| One concrete scenario using only this concept's own actions and queries              | `Principle`               |
| The owned facts themselves                                                           | `State`                   |
| The precondition, effect, and refusal of each transition                             | `Actions`                 |
| What a query answers, in what order, and what it answers when nothing matches        | The query's indented body |
| What each type name is: allocated identity, opaque external identity, or owned value | `Types`                   |

Give each name one classification in `Types`, without restating the
classification. For example: "`Subject` is an opaque external identity."

Choose a section according to the statement's subject, not according to the
generated output. The parser discards `State`, so it does not appear in generated
read-back. `Types` and the other extension blocks do appear. This difference
does not move state descriptions into another section.

### Notation in prose

Use backticks for identity and domain values: subject `ari`, target `topic-7`.
Use quotation marks for content the concept owns as a `String`: Ari publishes
"First post." Use plain text for a person or object outside the concept: Asha
creates Saturday Workshop. Quotation marks around an opaque identity incorrectly
present the identity as string content.

## Action declarations

An `actions` fence contains zero or more left-aligned signatures. Indented lines
below a signature are its prose body.

````md
```actions
join (gathering: Gathering, member: Person) : return (membership: Membership)
  where gathering not in gatherings
  then
    refuse GATHERING_NOT_FOUND "There is no such gathering."
```
````

An action name must not begin with `_`, and the token after its input list must
be `: return`. The parser retains an inline output field list or a result type
expression and rejects missing or trailing signature text. It also retains the
normalized indented body. Registration does not interpret `where`, `then`,
state changes, operation order, or other prose as executable behavior.

### Refusal lines

The parser recognizes an indented line with this form:

```text
refuse CODE "Normative sentence."
```

The code must occur only once under an action, and the quoted sentence must not
be empty. The sentence uses JSON string escapes, including `\"` for a literal
double quote. A body line beginning with the literal text `refuse ` but not
matching the grammar is rejected. `registerConcept` requires a distinct
registered `Error` class for every refusal code and rejects extra mappings. The
decoded sentence supplies the registered detail for direct assembled calls; the
`Error` instance's message is ignored.

## Query declarations

A `queries` fence contains left-aligned signatures. Indented prose below a
signature describes its reader-facing behavior:

````md
```queries
_members (gathering: Gathering) : many (member: Person)
  answers no rows for an unknown Gathering
  orders rows by when each Person joined
_membership (gathering: Gathering, member: Person) : one (joined: Boolean)
  answers false when the Person is unknown
```
````

A query name must begin with `_`. Its promise is one of:

| Promise    | Implementation result                     | Runtime check                                 |
| ---------- | ----------------------------------------- | --------------------------------------------- |
| `one`      | one non-null, non-array object            | exactly one object                            |
| `optional` | an array containing zero or one object    | at most one object                            |
| `many`     | an array containing any number of objects | every element is a non-null, non-array object |

The parser records inputs, promise, row fields or result type, and body.
Registration does not interpret query bodies; test their claims in the
implementation. Reactions, views, and formers check result containers and
cardinality, but not row values. Direct instrumented query calls bypass this
check; see [the processing map](../../project/concept-specification-processing.md#runtime-and-tooling).

An omitted `## Actions` or `## Queries` section, or a section without its
matching fence, declares no members of that kind. A present declaration fence
must be closed.

## State notation

A `## State` section is optional and has no dedicated grammar. `parseSpec`
discards it, and neither `registerConcept` nor `sync-engine check` compares it
with fields, implementations, database models, or storage. It does not appear in
metadata, manifests, read-back, wire contracts, input contracts, or validators.
Headings and declaration fences inside State notation do not create document
sections or declarations.

Establish state properties and invariants in principle, implementation, and
backend constraint tests. Machine state conformance would require an explicit,
backend-neutral descriptor; State prose is not such a descriptor.

## `registerConcept` checks

`registerConcept({ class, spec, ... })` inventories callable prototype methods
from the registered class and its base classes up to, but not including,
`Object.prototype`. An inherited method can therefore satisfy a specification
declaration and is also rejected when the specification does not declare it.
The function performs these checks against the parsed document:

- action and query names agree in both directions;
- every declared refusal code has one distinct `Error` class;
- no extra refusal mapping exists;
- input names agree when runtime reflection can recover a non-empty,
  top-level destructured parameter.

Registration also requires nonempty floor names and function-valued floor
factories, independently of the specification. Runtime reflection cannot recover
every erased TypeScript signature: a placeholder, plain, absent, empty, or nested
parameter can skip input-name comparison.

## `sync-engine check` checks

`sync-engine check` reads `spec.md`, `registry.ts`, and the registered class's
TypeScript source. The class identifier passed to `registerConcept` must be a
named import, and its local name must match the class declaration in the target
file. The import's module specifier must resolve directly to that file as a
filesystem path. Relative paths are resolved from `registry.ts`; absolute paths
remain absolute. Class discovery does not use TypeScript module resolution,
aliased imports, or re-export chains. The checker compares methods declared
directly in that class with the action and query names.

The checker does not traverse base classes. A specification relying on an
inherited method can therefore pass `registerConcept` while failing the source
check.

Supported method parameter forms are:

- no parameter;
- one untyped object-destructured parameter with identifier keys and no rest;
- one parameter whose TypeScript-resolved type has a finite top-level object
  shape.

The semantic form includes local and imported aliases, interfaces and interface
extension, qualified names, re-exports, finite alias chains and intersections,
`Readonly`, `Pick`, `Omit`, equivalent finite mapped types, and finite
`Record` keys. A union is accepted only when every alternative exposes the same
input keys. Optional and readonly properties still contribute their names.

The check fails closed for differing union or distributed-intersection keys,
open index signatures, unresolved or cyclic aliases, unresolved mapped or
generic shapes, `any`, `unknown`, primitives, arrays, callables, multiple
parameters, plain untyped parameters, and nested or rest destructuring. A
failure names the method and parameter type, first unsupported operation,
declaration location, and alternative key sets when applicable.

Type resolution is limited to an expansion depth of 32 and 64 generated
alternative key sets. Exceeding either limit fails the check rather than
accepting an incomplete shape.

The checker loads the nearest `tsconfig.json`, uses its module resolution and
path mappings, and adds the concept source when the config excludes it. Without
a config it uses NodeNext resolution for the concept source and its imports.

The source checker skips methods marked TypeScript `private`, but runtime
registration can still see those prototype methods and may reject them as
unspecified actions. TypeScript `protected` prototype methods are visible to
both checks. Neither modifier hides a runtime helper; use ECMAScript `#private`
methods or module-level functions so both checks observe the same members.

Neither `registerConcept` nor `sync-engine check` validates action output
fields, query row fields, state notation, class fields, storage layout, or
runtime endpoint values.

## Caller obligations

Import the Markdown as text and pass it to `registerConcept`. Place `spec.md` and
`registry.ts` together under a CLI concept root. The class, refusal mappings, and
principle test conventionally share that directory, but the checker follows the
class path imported by `registry.ts`. After signature changes, run
`sync-engine check`; after behavior or State changes, run the relevant principle,
implementation, and backend constraint tests.

See [Define one behavior](../guide/authoring.md#define-one-behavior) for a worked example and [CLI
reference](cli.md#sync-engine-check) for command behavior.
