# Simple State Form (SSF)

```text
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] Parent [with field+]
aliasDecl := alias Alias for Target
field := [a|an] [optional] [name] (Type | primitive | enum | collection)
primitive := Number | String | Flag | Date | DateTime
```

Use one declaration or alias per line; indent fields. Names are exact. Named State field
and operation types supply candidates. A candidate becomes owned only when vendored
`plur` pluralizes it or one unique non-element structural name exactly to the other
authored spelling. No generated or transitive spelling is admitted. Externals, primitives, elements, exact
declarations, and ambiguous candidates are excluded.

Use `alias Alias for Target` for synonyms or ambiguity; valid explicit intent wins.
Alias targets are unique structures, never aliases. Subset parents may use structures or
either alias kind. Invalid or cyclic parents fail after normalization.

Structural and explicit alias names share one State namespace. Field names are unique
per declaration and enum values per enum. Other unresolved field values remain legal
refinements, not binding targets. Structural-looking malformed lines fail;
standalone invariants remain opaque prose.

Collections are never `optional` (empty means absent). No nested collections or unions.
Sets introduce identities—never add ID fields. Subsets classify existing parent members,
may overlap, and add relations; `element` has one member. Which side declares a relation
implies no storage, navigation, or ownership.

```state
a set of Items with
  a parent Item
  an optional dueAt DateTime
  a status of OPEN or DONE

a Completed set of Items

alias WorkItem for Items

at most one Item has each title
```
