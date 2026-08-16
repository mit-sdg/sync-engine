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

One declaration per line; indent fields. Types/subtypes/parameters start uppercase,
fields lowercase, enum values all-uppercase. Identifiers start with a letter then use
letters/digits/`_`. Consistent singular/plural type names are equivalent.

A field name may be omitted only for an object/parameter scalar or collection; infer
lowercase singular/plural from its type. Names are unique through an acyclic subset
hierarchy. Collections are never `optional` (empty means absent). No nested collections
or unions.

Sets introduce identities—never add ID fields. Subsets classify existing parent members,
may overlap, and add relations. `element` has exactly one member. Scalar, optional, set,
and seq mean one, zero-or-one, zero-or-more, and ordered zero-or-more. Declaration
direction implies no storage, navigation, or ownership of referenced identities.
Standalone invariant sentences such as
`at most one Membership has each gathering and member pair` may follow the
declarations inside the fence.

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
