# Simple State Form (SSF)

```text
document := (setDecl|subsetDecl|aliasDecl|ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) setName (element|set) [of] [parentName] Type [condition] [with] declarationBody?
condition := where fieldName is VALUE (or VALUE)*
declarationBody := (INDENT (field|uniqueLine|ruleLine))+
aliasDecl := alias Alias for Type
field := [a|an] modifier* [fieldName] (named|collection)
modifier := optional|unique
uniqueLine := unique fieldName (and fieldName)*
named := Type|Parameter|Local|primitive
collection := (set|seq) [of] named
primitive := Number|String|Flag|Date|DateTime
ruleLine := Rule: TEXT

typesLine := (external Name|opaque Name|Name is VALUE (or VALUE)+) [INDENT TEXT]
```

Start Type, Alias, Parameter, and Local uppercase ASCII and fieldName, setName, and
parentName lowercase; continue each with ASCII letters, digits, or `_`. Start VALUE
uppercase and continue with uppercase ASCII letters, digits, or `_` only. A field without
a fieldName is named for its type with a lowercase first letter: `an Author` is
`author`, `a set of Tags` is `tags`. Write names when two fields share a type.

Declare every type in the Types fence: `external Name` for an application-supplied
parameter, `Name is A or B` for an enumeration, `opaque Name` when the representation is
deliberately the implementer's. A name that is none of these, nor owned, nor primitive, fails
with `SSF_UNDECLARED_TYPE`, in a State field or anywhere in an action or query signature,
including inside a type argument or union. Owned, external, concept-local, and primitive
names are one namespace. Never name a type for a primitive—write the primitive on the
field and state what narrows it where it is enforced.

Make every nonblank line parse or start with `Rule:`. Put a `Rule:` line at top level or
indented under a declaration; SSF keeps its TEXT verbatim and proves nothing. A top-level
rule ends the preceding declaration body. End a first line with `with` only when a field
or `unique` line follows, and always then; a `Rule:` line attaches without `with`.

A top-level set or sequence named for the plural of an external type, such as `a set of
Users` beside `external User`, holds individuals of that type and introduces no identity;
use it for the external individuals a concept records, with or without fields. Write
the plural—`a set of User` collides with the external name. Every other top-level
declaration introduces owned identities.

A subset is a lowercase named set, not a type: `a banned set of Users` classifies members
of `users`, and `a rejected set of banned Users` members of `banned`. An omitted parent
is the set the type implies—the concept's own set of that type, or every individual of
an external type the concept declares no set of. The type must match the parent's.
Never use a subset as a field type, alias target, signature type, or binding target;
take the type and state membership in prose, such as `where user is in banned`. Write
`user is in users` rather than `user exists` for an individual of an external type.

SSF accepts automatic singular/plural aliases for owned sets and sequences, and for
external types, when an authored State field, subset line, or action/query signature
supplies one unambiguous matching name. Declare an explicit `alias` for a synonym or an
ambiguous singular/plural relationship; the explicit declaration takes precedence.

An alias targets one unique owned set or sequence. It cannot target another alias, an
element, a subset, an external or a set of one, an opaque or enum type, a primitive, a
duplicate, or an unresolved name. Alias collisions and chains, ambiguous automatic
relationships, duplicate set names, mismatched subset types, self-parenting, and parent
cycles are rejected.

Structures, aliases, externals, local types, and primitives share one type universe; set
names have their own, which includes each top-level declaration's implied name (`a set of
Items` is `items`). A field cannot be named `optional`, `unique`, `set`, or `seq`. Keep
fieldNames unique per declaration and VALUEs per enum. Every State and signature type must resolve to an owned,
external, local, or primitive type.

Mark a field `unique` when its values must be unique among members of that declaration; a
unique collection field compares the whole collection. A `unique` line names the fields of
one constraint; the modifier is shorthand for a line naming that field alone, so use the
line where the field is inherited rather than declared. Order does not distinguish a
combination; a declaration may carry several. A subset's constraints bind only its own
members and may name ancestor fields. Condition a subset on a field whose type is a
declared enumeration to state which members it classifies. Write each modifier
at most once, in either order, between any article and the fieldName; `a` and `an` both
read. Case separates the forms: `unique Email` is a unique field named `email`, and
`unique email` a constraint line. Collections are never `optional` (empty means absent)
or nested; named-type unions are invalid. Owned sets and sequences introduce
identities—never add ID fields. Subsets add no identity; they classify parent members,
may overlap, and add relations. `element` has one member. Which side declares a relation implies no storage, navigation, or ownership.

```state
a set of Items with
  a unique title String
  an item Item
  an optional owner Person
  a watchers set of Person
  an updates seq of Update
  a Status

a set of Votes with
  an Item
  a Voter
  unique item and voter

a completed set of Items where status is DONE with
  a completedAt DateTime

a muted set of People

an element Settings with
  a retentionDays Number

alias WorkItem for Items

Rule: an Item's owner must be active
```
