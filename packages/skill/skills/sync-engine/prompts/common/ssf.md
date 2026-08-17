# Simple State Form (SSF)

```text
schema := (setDecl | subsetDecl)*
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype) [with field+]
field := [a|an] [optional] [name] (scalar|collection)
scalar := Type | Parameter | primitive | (of VALUE (or VALUE)+)
collection := (set|seq) [of] scalar
primitive := Number | String | Flag | Date | DateTime
```

Use one declaration per line and indent fields. Types start uppercase, fields lowercase,
enums uppercase; identifiers use letters/digits/`_`. Declaration and subset spellings
are exact. A collection spelling is related to a singular/plural spelling only when the
second exact name also appears in a State field type or action/query signature in this
specification. `element` names remain exact. The parser never invents an owned name.
It records subsets and inventories structural identity/type names. Malformed structural-looking lines fail; standalone invariants
remain opaque prose.

Omit a field name only for an object/parameter. Collections are never `optional` (empty
means absent). No nested collections or unions. Sets introduce identities—never add ID
fields. Subsets classify existing parent members, may overlap, and add relations;
`element` has one member. Declaration direction implies no storage, navigation, or
ownership. `at most one Membership has each gathering and member pair` is an opaque
invariant, not a proved behavior.

```state
a set of Items with
  a title String
  an optional dueAt DateTime
  a members set of Person
  a status of OPEN or DONE

a Completed set of Items with
  a completedAt DateTime

an element Settings with
  a retentionDays Number

at most one Item has each title
```
