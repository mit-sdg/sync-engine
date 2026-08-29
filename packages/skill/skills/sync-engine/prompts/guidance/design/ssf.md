# Simple State Form (SSF)

```text
document := (setDecl|subsetDecl|aliasDecl|ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with] declarationBody?
declarationBody := (INDENT (field|uniqueLine|ruleLine))+
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] modifier* fieldName (scalar|collection)
modifier := optional|unique
uniqueLine := unique fieldName (and fieldName)+
scalar := named|enum
named := Type|Parameter|primitive
enum := of values
collection := (set|seq) [of] (named|values)
values := VALUE (or VALUE)+
primitive := Number|String|Flag|Date|DateTime
ruleLine := Rule: TEXT
```

Start Type, Subtype, Alias, and Parameter uppercase ASCII and fieldName lowercase;
continue both with ASCII letters, digits, or `_`. Start VALUE uppercase and continue
with uppercase ASCII letters, digits, or `_` only. Always write fieldName.

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

Structures, aliases, externals, and primitives share one State namespace. Keep
fieldNames unique per declaration, VALUEs per enum. An unresolved field value is a
legal conventional/refinement reference, not an owned binding target.

Mark a field `unique` when its values must be unique among members of that declaration; a
unique collection field compares the whole collection. Constrain a combination with a
`unique` line naming two or more fields—never one, which the modifier already says.
Order does not distinguish a combination; a declaration may carry several. A subset's
constraints bind only its own members and may name ancestor fields. Write each modifier
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
  an updates seq of Updates
  a status of OPEN or DONE

a set of Votes with
  an item Item
  a voter Voter
  unique item and voter

a Completed set of Items with
  a completedAt DateTime

an element Settings with
  a retentionDays Number

alias WorkItem for Items

Rule: an Item's owner must be active
```
