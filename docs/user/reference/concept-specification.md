# Concept specification format

A concept specification is a Markdown file passed to `registerConcept` as text.
The parser extracts `Purpose`, `Principle`, structured action and query
signatures, descriptive bodies, refusal branches, and source locations. The
resulting `ConceptSpec` is independent of TypeScript syntax. Registration uses
only member names, input names, query cardinalities, and refusal branches for
runtime behavior; the other parsed fields remain authored contract data.

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

The parser reads the two prose sections, complete signatures, member bodies,
and refusal line. Registration checks the names, inputs, query promise, and
refusal branch. It does not infer a runtime schema or executable behavior from
the parsed type expressions, results, or prose.

| Layer                              | Establishes                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Specification parser               | Complete declaration syntax, descriptions, promises, refusals, and locations |
| `registerConcept`                  | Agreement with callable runtime methods and refusal mappings                 |
| `sync-engine check`                | Agreement with supported TypeScript source forms                             |
| Principle and implementation tests | Behavioral sequence, state changes, returned values, and invariants          |

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
significant. Duplicate reserved sections are rejected.

An `actions` fence is recognized only within `## Actions`, and a `queries` fence
only within `## Queries`. A reserved fence in an example, State notation, or any
other section cannot replace the declaration block. More than one matching
fence in a section is rejected.

Within each declaration fence, every member name must be unique. An indented
declaration body must follow a left-aligned signature; a body before the first
signature is rejected. Blank body lines are retained after outer blank lines
and common indentation are removed.

## Signature grammar

Action and query signatures use the following independent grammar:

```text
action       = name "(" fields? ")" ":" "return" result
query        = "_" name "(" fields? ")" ":" promise result
fields       = field ("," field)*
field        = name "?"? ":" type
result       = "(" fields? ")" | type
promise      = "one" | "optional" | "many"
type         = named-type | "null" | "undefined" | "(" type ")" | type "|" type
named-type   = qualified-name ("<" type ("," type)* ">")?
```

Names are ASCII JavaScript-style identifiers. A qualified type name joins such
identifiers with dots. Commas inside generic arguments and delimiters inside
parenthesized types do not split the surrounding field list. The parser retains
field names, optionality, type structure, result structure, and one-based source
locations. It does not resolve a type name against TypeScript or validate values
at runtime.

## Documentation sections

`## Types` and other non-reserved second-level sections are retained as ordered
reader-facing documentation blocks. `Types` is identified explicitly; every
other heading is an extension block. Their Markdown bodies and source locations
survive in `ConceptSpec`, application manifests, and generated read-back.

`Purpose`, `Principle`, `State`, `Actions`, and `Queries` are reserved and are
not extension blocks. State remains deliberately excluded. Documentation blocks
do not add registration or runtime semantics; use tests to establish any claim
they make.

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
be `: return`. The parser retains an inline output field list or a named result
type and rejects missing or trailing signature text. It also retains the
normalized indented body. Registration does not interpret `where`, `then`,
state changes, operation order, or other prose as executable behavior.

### Refusal lines

The parser recognizes an indented line with this form:

```text
refuse CODE "Normative sentence."
```

The code must occur only once under an action, and the quoted sentence must not
be empty. The sentence uses JSON string escapes, including `\"` for a literal
double quote. A body line beginning with `refuse` but not matching the grammar is
rejected. `registerConcept` requires one distinct registered `Error` class for
every refusal code and rejects extra mappings. The decoded sentence supplies
the registered detail for direct assembled calls; the `Error` instance's
message is ignored.

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

| Promise    | Implementation result                         | Runtime check                                 |
| ---------- | --------------------------------------------- | --------------------------------------------- |
| `one`      | one record                                    | exactly one record                            |
| `optional` | an array containing zero or one record        | no more than one record                       |
| `many`     | an array containing any number of record rows | every element is a non-null, non-array object |

The parser records the structured inputs, promise, inline row fields or named
row type, and normalized body. Query bodies are not registration data and
acquire no refusal or runtime semantics; establish their claims in
implementation tests. The engine checks the result container and cardinality
when a reaction, view, or former reads the query. It does not check row values
against the parsed row declaration.

An omitted `## Actions` or `## Queries` section, or a section without its
matching fence, declares no members of that kind. A present declaration fence
must be closed.

## State notation

A `## State` section is optional and has no dedicated grammar. Headings inside
its fenced notation are not document sections, and declaration fences there are
not associated with `## Actions` or `## Queries`.

State notation is discarded by `parseSpec`, and `ConceptSpec` has no state
member. Neither `registerConcept` nor `sync-engine check` compares it with class
fields, floor implementations, database models, or storage layout. It
contributes nothing to concept metadata, application manifests, assembled
read-back, generated wire contracts, endpoint input contracts, or endpoint
validators. No runtime schema is inferred from it.

Establish state properties and invariants in principle tests, direct
implementation tests, and backend constraint tests. Any future machine state
conformance requires an explicit, separately designed, backend-neutral
descriptor; prose in a State section will not be inferred as that descriptor.

## `registerConcept` checks

`registerConcept({ class, spec, ... })` inventories callable prototype methods
from the registered class and its base classes up to, but not including,
`Object.prototype`. An inherited method can therefore satisfy a specification
declaration and is also rejected when the specification does not declare it.
The function performs these checks against the parsed document:

- action and query names agree in both directions;
- every declared refusal code has one distinct `Error` class;
- no extra refusal mapping exists;
- floor names are non-empty and floor values are functions;
- input names agree when runtime reflection can recover a non-empty,
  top-level destructured parameter.

Runtime reflection cannot recover every erased TypeScript signature. A
placeholder, plain, absent, empty, or nested parameter can skip the runtime
input-name comparison.

## `sync-engine check` checks

`sync-engine check` reads `spec.md`, `registry.ts`, and the registered class's
TypeScript source. `registry.ts` must use a named import whose module specifier
resolves directly to the source file that declares the class; class discovery
does not follow re-export chains. The checker compares methods declared directly
in that class with the action and query names. It does not traverse a base class,
so a specification relying on an inherited method can pass `registerConcept`
while failing the source check.

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

Import the Markdown file as text and pass that string to `registerConcept`.
Keep `spec.md`, the class, refusal mappings, and the principle test in the same
concept directory so the default CLI search can discover them. Run
`sync-engine check` after changing a parsed action or query signature, and run
the relevant principle, implementation, and backend constraint tests after
changing behavior or state notation.

See [Define one behavior](../guide/authoring.md#define-one-behavior) for a worked example and [CLI
reference](cli.md#sync-engine-check) for command behavior.
