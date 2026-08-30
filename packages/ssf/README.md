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
  a status Status

a set of Votes with
  an item Item
  a voter Voter
  unique item and voter

a Completed set of Items where status is DONE with
  a completedAt DateTime

an element Settings with
  a retentionDays Number

alias WorkItem for Items
```

## Grammar

```text
document := (setDecl | subsetDecl | aliasDecl | ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) Subtype (element|set) [of] Parent [condition] [with] declarationBody?
condition := where fieldName is VALUE (or VALUE)*
declarationBody := (INDENT (field | uniqueLine | ruleLine))+
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] modifier* fieldName (named|collection)
modifier := optional | unique
uniqueLine := unique fieldName (and fieldName)*
named := Type | Parameter | Local | primitive
collection := (set|seq) [of] named
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
  a status Status
  a flags set of Visibility
```

An indented field may omit its article, and `a` and `an` both read. The modifiers
`optional` and `unique` go between the article and the field name, each at most once and
in either order. Collections are never optional; an empty collection represents absence.
Field names are unique within their declaration. A collection uses `set` or `seq` with an
optional `of`, and holds scalars rather than further collections. Named-type unions are
not part of SSF: `or` separates enumeration values, which are unique within their
enumeration.

## Uniqueness

Prefix a field with `unique` when its values must be unique among members of that
declaration:

```state
a set of Items with
  a unique title String
```

When it is a _combination_ of fields that must be unique, put `unique` on its own line
and join the field names with `and`:

```state
a set of Votes with
  an item Item
  a voter Voter
  a direction Direction
  unique item and voter
```

No two Votes share both an item and a voter, though many Votes share either one. The
modifier is shorthand for a line naming that one field, so write the modifier where the
field is declared and the line where it is inherited. Field order does not distinguish a
combination, and a declaration may carry several.

The constraint applies to the declaration carrying it. A `unique` field or line on a
subset constrains only members of that subset, and may name the parent's fields as well
as the subset's own. An `optional unique` field may be absent from multiple members;
values that are present remain unique. A `unique` collection field compares the whole
collection, so no two members hold the same set or the same sequence:

```state
a set of Conversations with
  a unique participants set of Person
```

## Declared types

Every name a field value uses resolves to one of four things: an identity this State
owns, an external parameter, an SSF primitive, or a concept-local type — and a name that
resolves to none of them draws `SSF_UNDECLARED_TYPE`. Concept-local types are declared
beside the external parameters in the concept's `types` fence:

```types
external Person
  The person who authors a note.

Username is String
  A login name, unique among accounts.

Status is OPEN or DONE
  Whether the item is still open.

opaque Secret
  A password verifier; its representation is the implementer's choice.
```

`Name is <primitive>` refines a primitive; the rules that narrow it live in the action
branches, not here. `Name is A or B` is an enumeration, and its values are the ones a
subset condition may test. `opaque Name` says the representation is deliberately the
implementer's business — the explicit way to opt out rather than the accidental one.
Refining an _identity_ is what a subset already does, so a refinement base is a primitive.

SSF itself takes these names as given; the concept parser owns the `types` fence and
reports its own form, duplicate, and collision diagnostics.

## Subset conditions

A subset may state which members it classifies by testing a field against declared
enumeration values:

```state
a set of Invitations with
  a target Target
  an invitee Person
  a status InvitationStatus

a Pending set of Invitations where status is PENDING with
  unique target and invitee
```

The field resolves against the subset and its ancestors, and every tested value has to
be one the field's enumeration declares. A condition on a field whose type is not a
declared enumeration fails, as does an unknown value.

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

SSF proves the structural declarations, their graph, the uniqueness constraints and the
fields they name, and the owned type names they establish. It does not prove rule text or refinement meaning,
and says nothing about behavior, storage layout, or implementation.
