# Simple State Form (SSF)

Simple State Form (SSF) is the State language for a concept specification. It is a
small English-like notation for structural State declarations. Write one declaration,
alias, or standalone invariant per top-level line. Put a declaration's fields on
following indented lines.

```state
a set of Items with
  a title String
  an optional owner Person
  a watchers set of Person
  a status of OPEN or DONE

a Completed set of Items with
  a completedAt DateTime

an element Settings with
  a retentionDays Number

alias WorkItem for Items

at most one Item has each title
```

## Grammar

The bounded document grammar is:

```text
document := (setDecl | subsetDecl | aliasDecl | opaque)*
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with field+]
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] (requiredField | optional optionalField)
requiredField := inferredField | fieldName (scalar|collection)
optionalField := named | fieldName scalar
inferredField := named | (set|seq) [of] named
scalar := named | enum
named := Type | Parameter | primitive
enum := of values
collection := (set|seq) [of] (named|values)
values := VALUE (or VALUE)+
primitive := Number | String | Flag | Date | DateTime
opaque := OPAQUE_LINE
```

`OPAQUE_LINE` means standalone non-structural invariant prose; it is not an escape for a
malformed structural-looking line. A top-level declaration uses `a set of Items`,
`a seq of Items`, or `an element Settings`. The `of` after a structural keyword is
optional. A declaration with fields ends its first line with `with`.

A subset declaration, such as `a Completed set of Items`, classifies members of an
existing parent. A subset may use `set` or `element`, but not `seq`. Every parent must
resolve by exact spelling to a unique structural identity or subset in the same State.
Forward references, exact explicit parent aliases, and chains are valid; external
parameters, primitives, unresolved or invalid aliases, self-parenting, and cycles are not.

## Automatic and explicit aliases

SSF can recognize two exact authored spellings as one owned type. It gathers candidates
from named State field types and from action/query parameter and result type expressions
in the containing concept. It never generates a candidate. For each candidate, SSF uses
the vendored `plur` 6.0.0 relation: pluralizing either authored spelling must exactly
yield the other. The candidate must match one unique non-element structure or subset.
For example, the field type `Item` establishes the additional owned spelling here:

```state
a set of Items with
  a related Item
```

This also supports irregular pairs such as `Mouse`/`Mice` and `Person`/`People`. External
parameters, primitives, and element declarations do not gain automatic aliases. An
ambiguous candidate remains unresolved. Exact structural declarations take precedence,
and automatic aliases are not fed back through pluralization, so no transitive or third
spelling appears.

Use an explicit alias when pluralization cannot uniquely express the intended relation:

```state
a set of People

alias Human for People
```

The canonical syntax is exactly `alias Alias for Target`. The alias name and target
begin with uppercase ASCII letters. The target may occur before or after the alias but
must be a unique, valid structural identity or subset. An alias cannot target another
alias, so alias chains and alias cycles are impossible. A valid explicit alias takes
precedence over automatic evidence with the same name. A subset parent may use either
kind of alias; graph validation normalizes that edge to the structural target. Explicit
alias names share the type namespace with structural declarations, external parameters,
primitives, and other explicit aliases and must be unique.

## Fields

A field may have an explicit lowercase name before its value form:

```state
  a title String
  an optional owner Person
  a members set of Person
  a history seq of Event
  a status of OPEN or DONE
  a flags set of VISIBLE or HIDDEN
```

An indented field may omit its article. `optional` precedes the field name and, when
an article is present, immediately follows it: `an optional owner Person`. Collections
are never optional; an empty collection represents absence.

A field name may be omitted only when a scalar or collection supplies one named type.
SSF lowercases only the first character of that exact type spelling:

```state
  a Profile
  a set of Options
```

These fields are named `profile` and `options`. Enumerations require an explicit field
name and do not supply inferred field names. Effective field names, including inferred
names, must be unique within one declaration. The same field name may occur in a different declaration.

A collection uses `set` or `seq`, with optional `of`, and cannot contain another
collection. Named and primitive elements use forms such as `watchers set of Person`;
enum elements use the natural `flags set of VISIBLE or HIDDEN`. Omitting the collection
`of` is also accepted, but a second `of` is malformed. Named-type unions are not part of
SSF. `or` occurs only between at least two enumeration values. Each value must be unique
within that one enumeration; the same value may occur in another field or enum.

## Names and namespaces

Type, parameter, declaration, subset, alias, target, and parent names begin with an
uppercase ASCII letter. Field names begin with a lowercase ASCII letter. Remaining
characters may be ASCII letters, digits, or `_`. Enumeration values begin with an
uppercase ASCII letter and otherwise use uppercase ASCII letters, digits, or `_`.

Structural declaration names are unique across the whole State. They must not exactly
collide with an external parameter or one of the five SSF primitives. Explicit alias
names use the same whole-State namespace. Field names are local to one declaration. Enumeration
values are local to one enumeration.

All joins retain exact authored spelling. Automatic alias resolution only compares two
authored names through the documented plural relation; it never corrects or inserts a
spelling.

## Reference boundary

SSF classifies every parsed named reference as owned, external, primitive, or
unresolved. Contexts that require ownership are closed: subset parents must resolve to
valid structural declarations or their automatic or explicit aliases; explicit alias
targets must resolve directly to valid structures or subsets. Application qualified
binding targets must resolve to an owned structural or alias spelling of the selected
instance.

State field value names remain an intentionally open authored namespace. A field may
refer to an owned identity, external parameter, primitive, conventional value type, or
concept-local refinement. An unresolved value is retained and classified as unresolved
but is not itself an SSF error. It becomes owned only when the bounded automatic-alias
rule establishes one unique non-element structure or subset owner. Action and query types
likewise need not occur in State; their exact spellings contribute alias candidates but do not otherwise
close the namespace.

## State meaning

A top-level set or sequence introduces identities. An element declaration has one
member. Fields declare relations on those identities; do not add ID fields for them. A
scalar field relates a member to a scalar value or another identity. A collection field
relates it to a set or sequence of values.

A subset introduces no identity. Subsets may overlap, and subset fields add relations
for classified members. Which side declares a relation implies nothing about storage,
navigation, or ownership.

## Opaque prose and canonical form

A prose line such as `at most one Item has each title` remains opaque text. SSF does
not interpret or prove it. A line beginning like a declaration, alias, or indented
field must complete that structural form; malformed structural-looking lines receive
source-located diagnostics rather than becoming prose.

Canonical top-level declarations use `a set`, `a seq`, or `an element`. A subset puts
`a` or `an` before its subtype. Fields require `with` on their declaration. Structural
keywords are exactly `set`, `seq`, and `element`; `array`, `list`, `sequence`, and
`sequences` are diagnosed near misses for `seq`, and `singleton` for `element`.

SSF proves bounded structural declarations, their graph integrity, and their exact
owned type inventory. It does not prove opaque invariants, field-value refinement
meaning, behavior, storage layout, or implementation semantics.
