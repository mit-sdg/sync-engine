# Simple State Form (SSF)

```text
document := (setDecl|subsetDecl|aliasDecl|ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) (element|set) [of] Qualifier+ Type [condition] [with] declarationBody?
condition := where fieldName is VALUE (or VALUE)*
declarationBody := (INDENT (field|uniqueLine|ruleLine))+
aliasDecl := alias Alias for Type
field := [a|an] modifier* [fieldName] (named|collection)
modifier := optional|unique
uniqueLine := unique fieldName (and fieldName)*
named := Qualifier* Type|Parameter|Local|primitive
collection := (set|seq) [of] named
primitive := Number|String|Flag|Date|DateTime
ruleLine := Rule: TEXT

typesLine := (external Name|opaque Name|Name is VALUE (or VALUE)+) [INDENT TEXT]
```

Start Type, Qualifier, Alias, Parameter, and Local uppercase ASCII and fieldName
lowercase; continue each with ASCII letters, digits, or `_`. Start VALUE uppercase and
continue with uppercase ASCII letters, digits, or `_` only. A field without a fieldName
is named for its type's words joined, with a lowercase first letter: `an Author` is
`author`, `a set of Tags` is `tags`, `a Verified User` is `verifiedUser`. Write names
when two fields share a type, and prefer a role name (`a sponsor Verified User`) when
the role matters.

Declare every type in the Types fence: `external Name` for an application-supplied
parameter, `Name is A or B` for an enumeration, `opaque Name` when the representation is
deliberately the implementer's. A name that is none of these, nor owned, nor primitive, nor
(in a State field) a declared subset, fails
with `SSF_UNDECLARED_TYPE`, in a State field or anywhere in an action or query signature,
including inside a type argument or union. Owned, external, concept-local, and primitive
names are one namespace. Never name a type for a primitive—write the primitive on the
field and state what narrows it where it is enforced.

Make every nonblank line parse or start with `Rule:`. Put a `Rule:` line at top level or
indented under a declaration; SSF keeps its TEXT verbatim and proves nothing. A top-level
rule ends the preceding declaration body. End a first line with `with` only when a field
or `unique` line follows, and always then; a `Rule:` line attaches without `with`.

A plain top-level set contains every individual of its type in the concept's state, and
each has its fields: with `a set of Users with a reputation Number`, every User any field
refers to is in `Users` and has a reputation. That holds whether the concept owns User or
takes it as `external User`; a set named for an external type's plural holds its
individuals and introduces no identity. Write the plural—`a set of User` collides with
the external name. The actions carry the obligation: storing a User makes it a member
with its fields, and removing a member removes or refuses every reference to it.

Declare a subset by qualifying its parent: `a set of Verified Users`, `a set of Trusted
Verified Users`, `an element Root Folder`. One capitalized word after the keyword is a
top-level set; more are a subset of the set the remaining words name, which must be
declared unless it is an external type's plural (`a set of Read Posts` beside `external
Post` needs no `a set of Posts`). The name is the whole phrase, `Verified Users` or `Verified User`, never the
qualifier alone. Use a qualified subset instead of a plain set, or instead of `optional`
fields, when only some individuals carry fields. A qualifier may qualify different sets
(`Pending Invitations`, `Pending Users`) but appears once among one set's subsets. Use a
subset as a State field type (`a sponsor Verified User`); in action and query signatures
take the parent type and state membership in a condition, such as `where sponsor is in
Verified Users`. Name the set for membership in any condition: `user is in Users`, not
`user exists`. Never write `a Verified set of Users` or `a verified set of Users`.

SSF accepts automatic singular/plural aliases for owned sets and sequences, and for
external types, when an authored State field, subset line, or action/query signature
supplies one unambiguous matching name; a subset phrase joins through its last word.
Declare an explicit `alias` for a synonym or an ambiguous singular/plural relationship;
the explicit declaration takes precedence.

An alias targets one unique owned top-level declaration: a set, sequence, or element. It
cannot target another alias, a subset, an external or a set of one, an opaque or enum type,
a primitive, a duplicate, or an unresolved name. Automatic singular/plural joins never
reach elements; only an explicit alias names one. Alias collisions and chains, ambiguous automatic
relationships, duplicate subsets, repeated qualifiers, and undeclared parents are
rejected.

Structures, aliases, externals, local types, and primitives share one type universe, and
a subset's joined identifier (`VerifiedUsers`, `VerifiedUser`) may not collide with it. A
field cannot be named `optional`, `unique`, `set`, or `seq`. Keep fieldNames unique per
declaration and VALUEs per enum. Every State type must resolve to an owned, external,
subset, local, or primitive type, and every signature type to one that is not a subset.

Mark a field `unique` when its values must be unique among members of that declaration; a
unique collection field compares the whole collection. A `unique` line names the fields of
one constraint; the modifier is shorthand for a line naming that field alone, so use the
line where the field is inherited rather than declared. Order does not distinguish a
combination; a declaration may carry several. A subset's constraints bind only its own
members and may name ancestor fields. Condition a subset on a field whose type is a
declared enumeration to state which members it classifies. Write each modifier
at most once, in either order, between any article and the fieldName; `a` and `an` both
read. Case separates the forms: `unique Email` is a unique field named `email`, and
`unique email` a constraint line; `a Verified User` holds a Verified User, while `a
verified User` is a field named `verified` holding any User. Collections are never `optional` (empty means absent)
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

a set of Completed Items where status is DONE with
  a completedAt DateTime

a set of Reviews with
  a Completed Item
  a reviewer Person

a set of Muted People

an element Settings with
  a retentionDays Number

alias WorkItem for Items

Rule: an Item's owner must be active
```
