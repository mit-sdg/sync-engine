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
rule ends the preceding declaration body. End a first line with `with` only when a real
field follows; a `Rule:` line does not count.

SSF owns structures, subsets, and accepted aliases. Named State fields and
action/query signatures supply alias candidates; SSF invents none. Vendored
`plur` must relate one candidate to one non-element owner, one-to-one, and yields no
transitive/third spelling. Declarations win; externals, primitives, elements, and
ambiguous candidates get no automatic alias.

Declare an alias for a synonym or ambiguous pair; it overrides automatic evidence.
Target a unique valid structure or subset, never an alias. Parent a subset on a structure,
subset, or either alias; forward chains work. Unresolved, external, primitive, and
invalid-alias parents, duplicate or ambiguous structures, self-parents, and cycles are
rejected.

Structures, aliases, externals, local types, and primitives share one type universe. A
field cannot be named `optional`, `unique`, `set`, or `seq`.
Keep fieldNames unique per declaration and VALUEs per enum. Resolve State first so
signature evidence can establish a plural join, then reject every signature name absent
from the resolved owned inventory, externals, local types, and primitives.

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
