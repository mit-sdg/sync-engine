# Simple State Form (SSF)

```text
document := (setDecl|subsetDecl|aliasDecl|opaque)*
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with field+]
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] (requiredField|optional optionalField)
requiredField := inferredField|fieldName (scalar|collection)
optionalField := named|fieldName scalar
inferredField := named|(set|seq) [of] named
scalar := named|enum
named := Type|Parameter|primitive
enum := of values
collection := (set|seq) [of] (named|values)
values := VALUE (or VALUE)+
primitive := Number|String|Flag|Date|DateTime
opaque := OPAQUE_LINE
```

One declaration/alias per line; indent fields. Type/Subtype/Alias/Parameter start
uppercase ASCII and fieldName lowercase; tails use ASCII letters, digits, or `_`. VALUE
starts uppercase; its tail uses only uppercase ASCII letters, digits, or `_`. OPAQUE_LINE
means standalone non-structural invariant prose. Omit fieldName only for `named` or an
inferred named collection, never an enum; SSF lowercases that exact name's first
character.

SSF owns exact structures/subsets and accepted aliases. Named State fields and
action/query input/result types supply alias candidates. One is owned only if vendored
`plur` pluralizes it to the exact spelling of one unique non-element structure or
subset, or that spelling to it. SSF generates no candidate or transitive/third
spelling. Exact declarations win; externals, primitives, elements, and ambiguous
candidates get no automatic alias.

Use explicit aliases for synonyms/ambiguity; they override automatic evidence. Targets
are unique valid structures/subsets, never aliases. Parents accept structures, subsets,
or either alias. Normalization rejects unresolved/external/primitive/invalid-alias
parents, duplicate/ambiguous structures, self-parents, and cycles; forward chains work.

Structures/explicit aliases/externals/primitives share one exact State namespace. Fields
are unique per declaration; VALUEs per enum. Unresolved field values are legal
conventional/refinement references, not owned binding targets. Malformed
structural-looking lines fail; standalone non-structural invariants stay opaque,
retained, not proved.

Collections are never `optional` (empty means absent) or nested; named-type unions are
invalid. Sets/sequences introduce identities—never add ID fields. Subsets add no identity;
they classify parent members, may overlap, and add relations. `element` has one
member. Which side declares a relation implies no storage, navigation, or ownership.

```state
a set of Items with
  a title String
  an Item
  an optional owner Person
  a watchers set of Person
  a seq of Updates
  a status of OPEN or DONE

a Completed set of Items with
  a completedAt DateTime

an element Settings with
  a retentionDays Number

alias WorkItem for Items

at most one Item has each owner and title pair
```
