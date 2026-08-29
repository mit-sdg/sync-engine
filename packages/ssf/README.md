# Simple State Form (SSF)

Simple State Form (SSF) is the State language for a concept specification: a small
English-like notation for declaring the facts a concept owns. Write one declaration,
alias, or rule per top-level line, and put a declaration's fields and uniqueness
constraints on the following indented lines. All of it lives inside the concept's
`state` fence.

```state
a set of Items with
  a unique title String
  an optional owner Person
  a watchers set of Person
  a status of OPEN or DONE

a Completed set of Items with
  a completedAt DateTime

an element Settings with
  a retentionDays Number

alias WorkItem for Items
```

## Grammar

```text
document := (setDecl | subsetDecl | aliasDecl | ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with] declarationBody?
declarationBody := (INDENT (field | ruleLine))+
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] modifier* fieldName (scalar|collection)
modifier := optional | unique
scalar := named | enum
named := Type | Parameter | primitive
enum := of values
collection := (set|seq) [of] (named|values)
values := VALUE (or VALUE)+
primitive := Number | String | Flag | Date | DateTime
ruleLine := Rule: TEXT
```

Every nonblank line either matches this grammar or begins with `Rule:`. Anything else
gets a diagnostic that names its source location.

## Declarations

A top-level declaration uses `a set of Items`, `a seq of Items`, or `an element
Settings`. The `of` after a structural keyword is optional. A declaration with fields
ends its first line with `with` and needs at least one field; an attached `Rule:` line
does not count as one.

A subset such as `a Completed set of Items` classifies members of an existing parent. It
may use `set` or `element`, but not `seq`. The parent is a declaration, another subset,
or an alias for either, and may appear before or after the subset. A parent naming an
external parameter, a primitive, or nothing at all fails, as do self-parenting and
parent cycles.

## Fields

A field writes a lowercase name before its value:

```state
a set of Items with
  a title String
  an optional owner Person
  a members set of Person
  a history seq of Event
  a status of OPEN or DONE
  a flags set of VISIBLE or HIDDEN
```

An indented field may omit its article, and `a` and `an` both read. The modifiers
`optional` and `unique` go between the article and the field name, each at most once and
in either order. Collections are never optional; an empty collection represents absence.
Field names are unique within their declaration.

Prefix a field with `unique` when its values must be unique among members of that
declaration:

```state
a set of Items with
  a unique title String
```

The constraint applies to the declaration carrying the field. A `unique` field on a
subset constrains only members of that subset. An `optional unique` field may be absent
from multiple members; values that are present remain unique. A `unique` collection field
compares the whole collection, so no two members hold the same set or the same sequence:

```state
a set of Conversations with
  a unique participants set of Person
```

A collection uses `set` or `seq` with an optional `of`, and holds scalars rather than
further collections. Named-type unions are not part of SSF: `or` separates enumeration
values, which are unique within their enumeration.

## Aliases

A concept often spells one owned type two ways — `Items` in the declaration and `Item`
in a field or an operation signature. SSF joins the two when they are a singular/plural
pair, so both names denote the same owned type:

```state
a set of Items with
  a related Item
```

Both spellings have to be authored: SSF compares candidate names from State fields and
from action and query signatures against declaration names using the vendored `plur`
implementation, and never introduces a spelling of its own. Irregular pairs such as
`Mouse`/`Mice` and `Person`/`People` join the same way. The join needs one candidate and
one non-element declaration or subset on either side; where several match, SSF leaves
them unjoined and reports the skipped names as advice. Element declarations, external
parameters, and primitives never join.

Where the plural relation cannot express the intended synonym, declare it:

```state
a set of People

alias Human for People
```

The syntax is `alias Alias for Target`. The target is a declaration or subset — never
another alias, so chains cannot form — and may appear before or after the alias. An
explicit alias wins over a plural join of the same name.

## Names

Type, parameter, subset, alias, and parent names begin with an uppercase ASCII letter,
and field names with a lowercase one. The rest of a name may use ASCII letters, digits,
or `_`. Enumeration values begin with an uppercase letter and otherwise use uppercase
letters, digits, and `_`.

Declaration and alias names are unique across a concept's State and share that namespace
with the concept's external parameters and the SSF primitives. Field names are local to
their declaration, and enumeration values to their enumeration.

## What a field value may name

A field value may name an identity the concept owns, an external parameter, a primitive,
or a conventional or refined type that nothing declares. SSF records which of those it
is and leaves an unrecognized name as written: State is a design notation, not a closed
type universe. Action and query types are open in the same way.

Ownership matters where something is proved against it. Subset parents and alias targets
resolve within the same State, and an application's qualified binding target names an
owned spelling of the instance it targets.

## What the declarations mean

A top-level set or sequence introduces identities, and an element declaration has one
member. Fields declare relations on those identities, so there is no need for ID fields.
A scalar field relates a member to a value or another identity; a collection field
relates it to a set or sequence of values.

A subset introduces no identities of its own. Subsets may overlap, and their fields add
relations for the members they classify. Which side of a relation declares it implies
nothing about storage, navigation, or ownership.

## Rules

Prose the notation cannot express goes on a `Rule:` line, either at the top level or
indented under a declaration:

```state
Rule: an Item's owner must be active
```

SSF keeps the line as written and makes no claim about it, even when the text resembles
a declaration. A top-level rule closes the preceding declaration's body. `Rule:` is
case-sensitive and comes first on the line, followed by the rule itself. `rule:`, `RULE:`, `Invariant:`, `invariant:`, `Note:`, and `note:` are
reported as near misses.

## Canonical form

Top-level declarations read `a set`, `a seq`, or `an element`, and a subset puts its
article before the subtype: `a Completed set`. Fields need `with` on the declaration
line. The structural keywords are `set`, `seq`, and `element`; `array`, `list`,
`sequence`, and `sequences` are reported as near misses for `seq`, and `singleton` for
`element`.

SSF proves the structural declarations, their graph, field uniqueness constraints, and
the owned type names they establish. It does not prove rule text or refinement meaning,
and says nothing about behavior, storage layout, or implementation.
