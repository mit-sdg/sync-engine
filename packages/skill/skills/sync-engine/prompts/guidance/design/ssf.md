# Simple State Form (SSF)

```text
document := (setDecl|subsetDecl|aliasDecl|ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) Subtype (element|set) [of] Parent [condition] [with] declarationBody?
condition := where fieldName is VALUE (or VALUE)*
declarationBody := (INDENT (field|uniqueLine|ruleLine))+
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] modifier* fieldName (named|collection)
modifier := optional|unique
uniqueLine := unique fieldName (and fieldName)*
named := Type|Parameter|Local|primitive
collection := (set|seq) [of] named
primitive := Number|String|Flag|Date|DateTime
ruleLine := Rule: TEXT

typesLine := (external Name|opaque Name|Name is VALUE (or VALUE)+) [INDENT TEXT]
```

Start Type, Subtype, Alias, Parameter, and Local uppercase ASCII and fieldName lowercase;
continue both with ASCII letters, digits, or `_`. Start VALUE uppercase and continue
with uppercase ASCII letters, digits, or `_` only. Always write fieldName.

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

SSF accepts automatic singular/plural aliases for owned sets, sequences, and subsets when
an authored State field or action/query signature supplies one unambiguous matching name.
Declare an explicit `alias` for a synonym or an ambiguous singular/plural relationship;
the explicit declaration takes precedence.

An alias targets one unique valid owned set, sequence, or subset. It cannot target another
alias, an element, an external, an opaque or enum type, a primitive, a duplicate, or an
unresolved name. A subset parent resolves to an owned set, sequence, or subset, directly or
through a valid alias. Alias collisions and chains, ambiguous automatic relationships,
self-parenting, and parent cycles are rejected.

Structures, aliases, externals, local types, and primitives share one type universe. A
field cannot be named `optional`, `unique`, `set`, or `seq`. Keep fieldNames unique per
declaration and VALUEs per enum. Every State and signature type must resolve to an owned,
external, local, or primitive type.

Mark a field `unique` when its values must be unique among members of that declaration; a
unique collection field compares the whole collection. A `unique` line names the fields of
one constraint; the modifier is shorthand for a line naming that field alone, so use the
line where the field is inherited rather than declared. Order does not distinguish a
combination; a declaration may carry several. A subset's constraints bind only its own
members and may name ancestor fields. Condition a subset on a field whose type is a
declared enumeration to state which members it classifies. Write each modifier
at most once, in either order, between any article and the fieldName; `a` and `an` both
read. Collections are never `optional` (empty means absent) or nested; named-type unions
are invalid. Sets and sequences introduce identities—never add ID fields. Subsets add no
identity; they classify parent members, may overlap, and add relations. `element` has one
member. Which side declares a relation implies no storage, navigation, or ownership.

```state
a set of Items with
  a unique title String
  an item Item
  an optional owner Person
  a watchers set of Person
  an updates seq of Update
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

Rule: an Item's owner must be active
```
