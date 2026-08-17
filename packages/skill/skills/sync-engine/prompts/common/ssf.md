# Simple State Form (SSF)

```text
schema := (setDecl | subsetDecl)*
setDecl := [a|an] (element|set|seq) [of] Type [with field+]
subsetDecl := [a|an] Subtype (element|set) [of] (Type|Subtype) [with field+]
field := [a|an] [optional] [name] (scalar|collection)
scalar := Type | Parameter | primitive | (of VALUE (or VALUE)+)
collection := (set|seq) [of] scalar
primitive := Number | String | Flag | Date | DateTime
```

One declaration per line; indent fields. Types start uppercase, fields lowercase,
enum values uppercase. Identifiers start with a letter and use letters/digits/`_`.
Singular/plural types are equivalent. The parser records subsets and inventories owned
identity/type names for binding proof.

Omit a field name only for an object/parameter; infer lowercase singular/plural.
Names are unique through an acyclic subset hierarchy. Collections are never `optional` (empty means absent). No nested collections
or unions.

Sets introduce identities—never add ID fields. Subsets classify existing parent members,
may overlap, and add relations. `element` has exactly one member. Scalar, optional, set,
and seq mean one, zero-or-one, zero-or-more, and ordered zero-or-more. Declaration
direction implies no storage, navigation, or ownership of referenced identities.
Standalone invariant sentences such as
`at most one Membership has each gathering and member pair` may follow the
declarations inside the fence. They remain opaque prose; parsing proves no invariant, effect, storage, or behavior.

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
