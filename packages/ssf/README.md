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

a set of Completed Items where status is DONE with
  a completedAt DateTime

a set of Reviews with
  a Completed Item
  a reviewer Person

a set of People with
  a displayName String

a set of Muted People

an element Settings with
  a retentionDays Number

alias WorkItem for Items
```

## Grammar

```text
document := (setDecl | subsetDecl | aliasDecl | ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) (element|set) [of] Qualifier+ Type [condition] [with] declarationBody?
condition := where fieldName is VALUE (or VALUE)*
declarationBody := (INDENT (field | uniqueLine | ruleLine))+
aliasDecl := alias Alias for Type
field := [a|an] modifier* [fieldName] (named|collection)
modifier := optional | unique
uniqueLine := unique fieldName (and fieldName)*
named := Qualifier* Type | Parameter | Local | primitive
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

One capitalized word after the structural keyword declares a top-level set; two or more
declare a subset. A set is named by its type, `Items`, and prose uses that name, as in
`where item is in Items`. There is no lowercase name for a set.

A plain top-level set contains every individual of its type that appears anywhere in the
concept's state, and its fields hold for each of them. With `a set of Items with a title
String`, every Item that another declaration refers to is in `Items` and has a title.

## Sets of external types

A top-level set or sequence whose type is the plural of an external type holds
individuals of that external type rather than introducing identities of its own:

```types
external User
external Post
```

```state
a set of Users with
  a reputation Number

a set of Vouches with
  a sponsor User
  a candidate User
```

`Users` joins `User` with the vendored `plur` implementation, exactly as an owned plural
does, and the declaration's type resolves to the external `User`. The rule above applies
unchanged: every User in the state, including every sponsor and candidate, is in `Users`
and has a reputation. So the meaning of the state does not change when a type moves
between internal and external. Such a declaration owns no type, so an application cannot
bind another concept's parameter to it.

A concept that declares no plain set of an external type still has one implicitly:
`Users` is every User in its state, with no further claim. Declare a qualified subset
instead of a plain set when only some Users should carry fields, as below.

Write the plural. `a set of User`, named exactly for the external type, collides with it
and fails with a suggestion to write `a set of Users`. An `element` never joins, so `an
element Users` stays an owned element even beside `external User`.

## Subsets

A subset is named by qualifying its parent set, as you might in English:

```state
a set of Users with
  a reputation Number

a set of Verified Users with
  a verifiedOn Date

a set of Trusted Verified Users

a set of Vouches with
  a sponsor Verified User
  a candidate User
```

`a set of Q P` declares a subset of `P` with the qualifier `Q`, where `P` is a top-level
set or another subset. `Verified Users` holds some of `Users`, and `Trusted Verified
Users` some of `Verified Users`; each member also carries its ancestors' fields, so every
Verified User has a reputation and a verifiedOn date. `an element Root Folder` declares a
subset of `Folders` with exactly one member. A subset may use `set` or `element`, but not
`seq`, qualifies a set or sequence rather than an element, may appear before or after its
parent, and may state which members it classifies
with a condition, as below. Subsets are not disjoint, so a User may be both Verified and
Banned.

The name is the whole phrase, never the qualifier alone: `Verified Users` in the plural
and `Verified User` in the singular. A subset is a type, so a field may hold members of
it: `a sponsor Verified User` says every sponsor is a Verified User. Action and query
signatures take the type of the set a subset qualifies and state membership in a
condition, such as `vouch (sponsor: User, candidate: User)` with `where sponsor is in
Verified Users`; tooling rejects a subset as a signature type so no argument carries a
hidden precondition.

A qualifier may qualify different sets, such as `Pending Invitations` and `Pending Users`,
but appears only once among the subsets of one set: beside `Trusted Users` and `Verified
Users`, `Trusted Verified Users` fails, because it would look related to `Trusted Users`
without being its subset. A subset's parent must be declared, except the implicit set of
an external type, so `a set of Read Posts` beside `external Post` needs no `a set of
Posts`. Its identifier — the words joined, `VerifiedUsers` or `VerifiedUser` — must not
be another type's name.
`a Verified set of Users` and `a verified set of Users` are not SSF; the checker reports
each with its qualified spelling, `a set of Verified Users`.

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

A field may leave its name out, and then it is named for its type: the type's words
joined, with a lowercase first letter.

```state
a set of Comments with
  an Author
  a Target
  a content String
  a set of Tags
  a Verified User
```

The fields are `author`, `target`, `content`, `tags`, and `verifiedUser`, exactly as if
each name were written. Two fields of one type need written names, such as `an author
User` and `a reviewer User`; leaving both out names both `user`, which fails as a
duplicate. Give a field a role name when the role matters, as in `a sponsor Verified
User`, since otherwise changing its type from `User` to `Verified User` also renames it.

Case tells names and types apart: a name begins with a lowercase letter and a type with
an uppercase one. So `unique Email` is a unique field named `email`, while `unique email`
is a uniqueness line for a field already named `email`; and `a verified User` is a field
named `verified` holding a User, while `a Verified User` is a field named `verifiedUser`
holding a Verified User. A field named like a qualifier draws advice for that reason.

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

Every name a field value uses resolves to one of five things: an identity this State
owns, an external parameter, a subset, an SSF primitive, or a concept-local type — and a
name that resolves to none of them draws `SSF_UNDECLARED_TYPE`. Concept-local types are declared
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

a set of Pending Invitations where status is PENDING with
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
declarations and primitives never join. A subset's phrase joins through its last word,
so `Verified User` and `Verified Users` name the same subset.

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

Type, parameter, qualifier, and alias names begin with an uppercase ASCII letter, and
field names with a lowercase one. The rest of a name may use ASCII letters, digits, or
`_`. Enumeration values begin with an uppercase letter and otherwise use uppercase
letters, digits, and `_`.

Declaration and alias names are unique across a concept's State and share that namespace
with the concept's external parameters, its concept-local types, and the SSF primitives.
A subset's identifier in code joins its words, `VerifiedUsers` or `VerifiedUser`, and
must not collide with that namespace or with another subset's identifier in either
number. Field names are local to their declaration, and enumeration values to their
enumeration.

## What a field value may name

A field value may name an identity the concept owns, an external parameter or a joined
spelling of one, a subset, a concept-local enumeration or opaque type, or an SSF
primitive. An unrecognized State name is retained as unresolved and fails with
`SSF_UNDECLARED_TYPE`. Action and query signature types resolve against the same
closed universe, less subsets, and fail the same way, including when the name is nested
inside a type argument or union.

Ownership matters where something is proved against it. Subset parents and alias targets
resolve within the same State, and an application's qualified binding target names an
owned spelling or joined subset identifier of the instance it targets — never an external
parameter or a top-level set of an external type. A subset target records an authored
membership requirement; binding validation does not enforce membership at runtime.
Signature validation runs only after plural joins consume signature evidence, so a
singular spelling established by that join is owned before it is checked.

## What the declarations mean

A top-level set or sequence of an owned type introduces identities, and an element
declaration has one member. Fields declare relations on those identities, so there is no
need for ID fields. A scalar field relates a member to a value or another identity; a
collection field relates it to a set or sequence of values. A set of an external type
introduces no identities, but otherwise means the same: every individual of that type in
the state is a member, with every field it declares.

A subset introduces no identities of its own. Subsets may overlap, and their fields add
relations for the members they classify. Which side of a relation declares it implies
nothing about storage, navigation, or ownership.

State membership by naming the set: `where user is in Users`, `where sponsor is in
Verified Users`, or `where user is not in Banned Users`. The rule that a plain set holds
every individual of its type is an obligation on the actions, which tooling cannot
check: an action that stores a User must also make it a member of `Users` with its
fields, and removing a User from `Users` must remove or refuse every reference to it.
When only some individuals should carry fields, declare a qualified subset rather than a
plain set.

A field typed by a subset carries the same obligation. With `a set of Reminders with a
Pending Invitation`, an action that takes an invitation out of `Pending Invitations`
must also remove or refuse every Reminder that holds it. A field that should keep its
value after membership ends takes the parent type instead: `an Invitation`.

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

Top-level declarations and subsets read `a set of`, `a seq of`, or `an element`, followed
by their name: `a set of Completed Items`, `an element Root Folder`. Fields need `with` on the declaration
line. The structural keywords are `set`, `seq`, and `element`; `array`, `list`,
`sequence`, and `sequences` are reported as near misses for `seq`, and `singleton` for
`element`.

SSF proves the structural declarations, their graph, the uniqueness constraints and the
fields they name, the owned type names they establish, and the external spellings they
join. Tooling then checks action and
query signature names against that resolved inventory. Neither check proves rule text or
type meaning, and neither says anything about behavior, storage layout, or implementation.
