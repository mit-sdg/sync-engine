# Simple State Form (SSF)

```text
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] Parent [with field+]
aliasDecl := alias Alias for Target
field := [a|an] [optional] [name] (Type | primitive | enum | collection)
collection := (set|seq) [of] (Type | primitive | enum)
primitive := Number | String | Flag | Date | DateTime
```

Use one declaration or alias per line; indent fields. Types start uppercase,
fields lowercase, and names are exact. Only `alias Alias for Target` adds ownership.
Alias targets are unique structural declarations, never aliases. Subset parents may
name structures or exact aliases. Forward references work; unresolved, external,
primitive, invalid-alias, self, and cyclic parents fail after alias normalization.

The parser inventories structural identity/type names and explicit aliases; it never
invents an owned name. Structural and alias names share a State-wide namespace. Field names are unique per declaration and enum values per enum. Unresolved State field
values remain legal conventional/refinement references, but are not owned binding
targets. Malformed structural-looking lines fail; standalone invariants remain opaque
prose.

Collections are never `optional` (empty means absent). No nested collections or unions.
Sets introduce identities—never add ID fields. Subsets classify existing parent members,
may overlap, and add relations; `element` has one member. Which side declares a relation
implies no storage, navigation, or ownership.

```state
a set of Items with
  a title String
  an optional dueAt DateTime
  a members set of Person
  a status of OPEN or DONE

a Completed set of Items

an element Settings

alias Item for Items

at most one Item has each title
```
