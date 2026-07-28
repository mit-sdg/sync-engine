# Concept specification format

A concept specification is a Markdown file passed to `registerConcept` as text.
The parser extracts the `Purpose`, `Principle`, action signatures, query
signatures, and refusal lines. Other prose remains part of the human contract
but is not machine-checked.

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
heading. Heading text, capitalization, and level are significant.

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

An action name must be a JavaScript-style identifier and must not begin with
`_`. The parser splits the parameter list at every comma, then retains the
identifier before the first `:` in each item. Type text containing a comma is
therefore unsupported by this parser. The token after the signature colon must
be `return`.

The signature parser recognizes only the prefix through the `return` token. It
does not validate an output clause or reject trailing signature text. It also
does not interpret output names, state changes, `where`, `then`, or other
indented prose. These fields state the intended contract for readers and
principle tests rather than a fully parsed grammar.

### Refusal lines

The parser recognizes an indented line with this exact form:

```text
refuse CODE "Normative sentence."
```

The code must occur only once under an action, and the quoted sentence must not
be empty. `registerConcept` requires one distinct registered `Error` class for
every refusal code and rejects extra mappings. The sentence, not the `Error`
instance's message, is the registered detail for direct assembled calls.

## Query declarations

A `queries` fence contains left-aligned signatures and no indented bodies:

````md
```queries
_members (gathering: Gathering) : many (member: Person)
_membership (gathering: Gathering, member: Person) : one (joined: Boolean)
```
````

A query name must begin with `_`. Its promise is one of:

| Promise    | Implementation result                         | Runtime check                                 |
| ---------- | --------------------------------------------- | --------------------------------------------- |
| `one`      | one record                                    | exactly one record                            |
| `optional` | an array containing zero or one record        | no more than one record                       |
| `many`     | an array containing any number of record rows | every element is a non-null, non-array object |

The parser records input names and the promise token. As with actions, the
signature parser does not validate the output clause or trailing text. It does
not parse output fields or their types. The engine checks the result container
and cardinality when a reaction, view, or former reads the query. It does not
check row fields against the output list in the specification.

An omitted `actions` or `queries` fence declares no members of that kind. A
present fence must be closed.

## State declarations

A `state` fence and any other prose are not parsed. Registration does not check
state field types, uniqueness, output field names, invariants, or persistence.
Use the principle test and implementation-specific tests to establish those
properties.

## `registerConcept` checks

`registerConcept({ class, spec, ... })` performs checks available from the
runtime class and parsed document:

- action and query names agree in both directions;
- every declared refusal code has one distinct `Error` class;
- no extra refusal mapping exists;
- `publicErrors` names only declared refusal codes;
- floor names are non-empty and floor values are functions;
- input names agree when runtime reflection can recover a non-empty,
  top-level destructured parameter.

Runtime reflection cannot recover every erased TypeScript signature. A
placeholder, plain, absent, empty, or nested parameter can skip the runtime
input-name comparison.

## `sync-engine check` checks

`sync-engine check` reads `spec.md`, `registry.ts`, and the registered class's
TypeScript source. It compares action and query names and fails closed when it
cannot interpret a method's parameter syntax.

Supported method parameter forms are:

- no parameter;
- one untyped object-destructured parameter with identifier keys and no rest;
- one parameter typed with an inline object type containing only
  identifier-named property signatures;
- one parameter typed as `Record<..., never>`;
- one parameter using a direct same-file type alias to either supported typed
  form.

Unsupported forms include interfaces, imported or qualified types, alias
chains, intersections, unions, mapped and utility types, multiple parameters,
plain untyped parameters, and nested or rest destructuring. The check reports
unsupported syntax instead of assuming that the inputs agree.

The source checker skips methods marked TypeScript `private`, but runtime
registration can still see those prototype methods and may reject them as
unspecified actions. Use ECMAScript `#private` methods or module-level functions
for helpers so both checks observe the same members.

Neither `registerConcept` nor `sync-engine check` validates action output
fields, query row fields, state prose, or runtime endpoint values.

## Caller obligations

Import the Markdown file as text and pass that string to `registerConcept`.
Keep `spec.md`, the class, refusal mappings, and the principle test in the same
concept directory so the default CLI search can discover them. Run
`sync-engine check` after changing a method signature or specification, and run
the principle test after changing behavior.

See [Define one behavior](guide/concepts.md) for a worked example and [CLI
reference](cli.md#sync-engine-check) for command behavior.
