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
  an Item
  a Voter
  unique item and voter

a completed set of Items where status is DONE with
  a completedAt DateTime

a set of People with
  a displayName String

a muted set of People

an element Settings with
  a retentionDays Number

alias WorkItem for Items
```

## Grammar

```text
document := (setDecl | subsetDecl | aliasDecl | ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) setName (element|set) [of] [parentName] Type [condition] [with] declarationBody?
condition := where fieldName is VALUE (or VALUE)*
declarationBody := (INDENT (field | uniqueLine | ruleLine))+
aliasDecl := alias Alias for Type
field := [a|an] modifier* [fieldName] (named|collection)
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
ends its first line with `with` and needs at least one field or uniqueness constraint.
A `Rule:` line attaches to a declaration without `with` and satisfies neither.

Every top-level declaration also names a set: its type with a lowercase first letter.
`a set of Items` is the set `items`, and `a set of ReadPosts` is `readPosts`. Subsets and
prose refer to it by that name.

## Sets of external types

A top-level set or sequence whose type is the plural of an external type holds
individuals of that external type rather than introducing identities of its own:

```types
external User
external Post
```

```state
a set of Users with
  an Account

a set of Posts
```

`a set of Users` says which Users the concept knows about, and relates each of them to one
Account; `a set of Posts` is a set of Posts and nothing more, such as the posts a person
has read. `Users` joins `User` with the vendored `plur` implementation, exactly as an
owned plural does, and the declaration's type resolves to the external `User`. Such a
declaration owns no type, so an application cannot bind another concept's parameter to
it.

Write the plural. `a set of User`, named exactly for the external type, collides with it
and fails with a suggestion to write `a set of Users`. An `element` never joins, so `an
element Users` stays an owned element even beside `external User`.

## Subsets

A subset is a named set: it classifies members of a parent set and is not a type.

```state
a set of Users with
  an Account

a banned set of Users

a rejected set of banned Users
```

`banned` holds some of the members of `users`, and `rejected` some of the members of
`banned`. The line names the subset in lowercase, then the parent set, then the type the
members have. Leaving the parent out means the set the type implies: `a banned set of
Users` is short for `a banned set of users Users`. When the concept declares no set of an
external type, that set is every individual of the type, so beside `external Post`,

```state
a read set of Posts
```

holds Posts drawn from all of them. A written parent is either a subset or the set of a
top-level declaration, and the type has to be the one its members have; `a hidden set of
banned Posts` fails when `banned` holds Users. A subset may use `set` or `element`, but
not `seq`, and may appear before or after its parent.

Subsets are not disjoint, so a User may be both banned and muted. Because a subset is not
a type, a field, an alias, and an action or query signature name the type — `User`, not
`banned` — and a precondition states membership in prose, such as `where user is in
banned`. A subset's name is unique among the State's set names, including the ones
top-level declarations imply; an unresolved parent, self-parenting, a parent cycle, and a
type that differs from the parent's all fail with source-located diagnostics. An
uppercase subset name such as `a Completed set of Items` is the retired spelling and is
reported with its lowercase repair.

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

A field may leave its name out, and then it is named for its type with a lowercase first
letter:

```state
a set of Comments with
  an Author
  a Target
  a content String
  a set of Tags
```

The fields are `author`, `target`, `content`, and `tags`, exactly as if each name were
written. Two fields of one type need written names, such as `an author User` and `a
reviewer User`; leaving both out names both `user`, which fails as a duplicate. Case
tells the two forms apart: a name begins with a lowercase letter and a type with an
uppercase one, so `unique Email` is a unique field named `email`, while `unique email` is
a uniqueness line for a field already named `email`.

An indented field may omit its article, and `a` and `an` both read. The modifiers
`optional` and `unique` go between the article and the field name, each at most once and
in either order. Because a field's own name is read after them, `optional` and `unique`
cannot themselves name a field, and neither can `set` or `seq`; every other lowercase
name is free. Collections are never optional; an empty collection represents absence.
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
subset constrains only members of that subset, and may name its ancestors' fields as well
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

Status is OPEN or DONE
  Whether the item is still open.

opaque Secret
  A password verifier; its representation is the implementer's choice.
```

`Name is A or B` is an enumeration, and its values are the ones a subset condition may
test. `opaque Name` says the representation is deliberately the implementer's business.
Write an SSF primitive directly instead of declaring another name for it; constraints
that narrow a primitive belong where they are enforced. Refining an identity is what a
subset already does.

Declaration, alias, external, concept-local, and primitive names are one namespace: a
Types declaration may not shadow a primitive, and a State declaration may not shadow a
Types name. The concept parser owns the `types` fence and reports its form, duplicate,
and primitive-collision diagnostics; SSF reports collisions it can see against State.

## Subset conditions

A subset may state which members it classifies by testing a field against declared
enumeration values:

```state
a set of Invitations with
  a target Target
  an invitee Person
  a status InvitationStatus

a pending set of Invitations where status is PENDING with
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

Both spellings have to be authored: SSF compares candidate names from State fields,
subset lines, and action and query signatures against declaration and external names
using the vendored `plur` implementation, and never introduces a spelling of its own.
Irregular pairs such as `Mouse`/`Mice` and `Person`/`People` join the same way. A
candidate that pairs with an external type spells that type, so beside `external Tag`
the field `a set of Tags` holds Tags. The join needs one candidate and one owner — a
non-element top-level declaration or an external type — on either side; where several
match, SSF leaves them unjoined and reports the skipped names as advice. Element
declarations, subsets, and primitives never join.

Where the plural relation cannot express the intended synonym, declare it:

```state
a set of People

alias Human for People
```

The syntax is `alias Alias for Target`. The target is a top-level declaration that owns
its type — never another alias, so chains cannot form, and never a set of an external
type — and may appear before or after the alias. An explicit alias wins over a plural
join of the same name.

## Names

Type, parameter, and alias names begin with an uppercase ASCII letter, and field and set
names — subsets and their parents — with a lowercase one. The rest of a name may use
ASCII letters, digits, or `_`. Enumeration values begin with an uppercase letter and
otherwise use uppercase letters, digits, and `_`. A set name cannot be a structural
word: `element`, `of`, `optional`, `seq`, `set`, `unique`, `where`, or `with`.

Declaration and alias names are unique across a concept's State and share that namespace
with the concept's external parameters, its concept-local types, and the SSF primitives.
Set names are unique across the State in a namespace of their own. Field names are local
to their declaration, and enumeration values to their enumeration.

## What a field value may name

A field value may name an identity the concept owns, an external parameter or a joined
spelling of one, a concept-local enumeration or opaque type, or an SSF primitive. It never
names a subset. An unrecognized State name is retained as
unresolved and fails with `SSF_UNDECLARED_TYPE`. Action and query signature types resolve
against that same closed universe and fail the same way, including when the name is
nested inside a type argument or union.

Ownership matters where something is proved against it. Subset parents and alias targets
resolve within the same State, and an application's qualified binding target names an
owned spelling of the instance it targets — never a subset or a set of an external type. Signature validation runs only after plural
joins consume signature evidence, so a singular spelling established by that join is
owned before it is checked.

## What the declarations mean

A top-level set or sequence introduces identities, and an element declaration has one
member. Fields declare relations on those identities, so there is no need for ID fields.
A scalar field relates a member to a value or another identity; a collection field
relates it to a set or sequence of values. A set of an external type introduces no
identities: it records which individuals of that type the concept knows about, and its
fields relate each of them as a set of owned identities would.

A subset introduces no identities of its own. Subsets may overlap, and their fields add
relations for the members they classify. Which side of a relation declares it implies
nothing about storage, navigation, or ownership.

Say which set a member belongs to by naming the set. `note exists` is clear for an owned
Note, because a Note exists only inside the concept that introduces it. An individual of
an external type exists whether or not the concept records it, so write `user is in
users`, `user is in banned`, or `user is not in banned`.

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
article before its lowercase name: `a completed set`. Fields need `with` on the declaration
line. The structural keywords are `set`, `seq`, and `element`; `array`, `list`,
`sequence`, and `sequences` are reported as near misses for `seq`, and `singleton` for
`element`.

SSF proves the structural declarations, their graph, the uniqueness constraints and the
fields they name, the owned type names they establish, and the external spellings they
join. Tooling then checks action and
query signature names against that resolved inventory. Neither check proves rule text or
type meaning, and neither says anything about behavior, storage layout, or implementation.
