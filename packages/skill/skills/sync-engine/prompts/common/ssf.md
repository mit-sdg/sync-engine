# Simple State Form (SSF)

```text
document := (setDecl|subsetDecl|aliasDecl|ruleLine)*
setDecl := (a|an) (element|set|seq) [of] Type [with] declarationBody?
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with] declarationBody?
declarationBody := (INDENT (field|ruleLine))+
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
ruleLine := Rule: TEXT
```

Type/Subtype/Alias/Parameter start uppercase ASCII and fieldName lowercase; tails use
ASCII letters, digits, or `_`. VALUE starts uppercase; its tail uses only uppercase ASCII
letters, digits, or `_`. A `Rule:` line may be top-level or declaration-indented; its
TEXT is retained verbatim, not proved. Every other nonblank line must parse. A top-level
rule ends the preceding declaration
body. Omit fieldName only for `named` or an inferred named collection, never an enum; SSF
lowercases that exact name's first character.

SSF owns exact structures/subsets and accepted aliases. Named State fields and
action/query input/result types supply alias candidates. Vendored `plur` must relate one
candidate to one non-element owner, one-to-one. SSF generates no candidate or
transitive/third spelling. Exact declarations win; externals, primitives, elements, and
ambiguous candidates get no automatic alias.

A declaration ending in `with` needs a real field; a `Rule:` line does not count.
Use explicit aliases for synonyms/ambiguity; they override automatic evidence. Targets
are unique valid structures/subsets, never aliases. Parents accept structures, subsets,
or either alias. Normalization rejects unresolved/external/primitive/invalid-alias
parents, duplicate/ambiguous structures, self-parents, and cycles; forward chains work.

Structures/explicit aliases/externals/primitives share one exact State namespace. Fields
are unique per declaration; VALUEs per enum. Unresolved field values are legal
conventional/refinement references, not owned binding targets.

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

Rule: at most one Item has each owner and title pair
```
