# Simple State Form (SSF)

Simple State Form (SSF) is the State language for a concept specification. It is a
small English-like notation for structural State declarations. Write one declaration
or alias per top-level line. Put a declaration's fields on following indented lines.

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

alias Item for Items

at most one Item has each title
```

## Grammar

The bounded structural grammar is:

```text
schema := (setDecl | subsetDecl | aliasDecl)*
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype|Alias) [with field+]
aliasDecl := alias Alias for (Type|Subtype)
field := [a|an] [optional] [name] (scalar|collection)
scalar := Type | Parameter | primitive | (of VALUE (or VALUE)+)
collection := (set|seq) [of] scalar
primitive := Number | String | Flag | Date | DateTime
```

A top-level declaration uses `a set of Items`, `a seq of Items`, or
`an element Settings`. The `of` after a structural keyword is optional. A declaration
with fields ends its first line with `with`.

A subset declaration, such as `a Completed set of Items`, classifies members of an
existing parent. A subset may use `set` or `element`, but not `seq`. Every parent must
resolve by exact spelling to a unique structural identity or subset in the same State.
Forward references, exact explicit parent aliases, and chains are valid; external
parameters, primitives, unresolved or invalid aliases, self-parenting, and cycles are not.

## Exact aliases

An alias explicitly adds one exact owned spelling:

```state
a set of People

alias Person for People
```

The canonical syntax is exactly `alias Alias for Target`. The alias name and target
begin with uppercase ASCII letters. The target may occur before or after the alias but
must be a unique, valid structural identity or subset. An alias cannot target another
alias, so alias chains and alias cycles are impossible. A subset parent may use an exact
alias; graph validation normalizes that edge to the alias's structural target. Alias names share the type
namespace with structural declarations, external parameters, primitives, and other
aliases and must be unique.

Aliases are the only way to add another owned spelling; SSF never derives one. A field,
action, or query that mentions `Person` does not make `Person` an alias for `People`;
author the alias declaration when both exact spellings are intended to denote the same
owned type.

## Fields

A field may have an explicit lowercase name before its value form:

```state
  a title String
  an optional owner Person
  a members set of Person
  a history seq of Event
  a status of OPEN or DONE
```

An indented field may omit its article. `optional` precedes the field name and, when
an article is present, immediately follows it: `an optional owner Person`. Collections
are never optional; an empty collection represents absence.

A field name may be omitted when its value supplies a named type. SSF lowercases only
the first character of that exact type spelling:

```state
  a Profile
  a set of Options
```

These fields are named `profile` and `options`. Enumerations do not supply inferred
field names. Effective field names, including inferred names, must be unique within one
declaration. The same field name may occur in a different declaration.

A collection uses `set` or `seq`, with optional `of`, and cannot contain another
collection. Named-type unions are not part of SSF. `or` occurs only between at least
two enumeration values. Each value must be unique within that one enumeration; the
same value may occur in another field or enum.

## Names and namespaces

Type, parameter, declaration, subset, alias, target, and parent names begin with an
uppercase ASCII letter. Field names begin with a lowercase ASCII letter. Remaining
characters may be ASCII letters, digits, or `_`. Enumeration values begin with an
uppercase ASCII letter and otherwise use uppercase ASCII letters, digits, or `_`.

Structural declaration names are unique across the whole State. They must not exactly
collide with an external parameter or one of the five SSF primitives. Alias names use
the same whole-State namespace. Field names are local to one declaration. Enumeration
values are local to one enumeration.

All joins use exact authored spelling. Nothing is case-folded, inflected, corrected, or
silently generated.

## Reference boundary

SSF classifies every parsed named reference as owned, external, primitive, or
unresolved. Contexts that require ownership are closed: subset parents must resolve to
valid structural declarations or their explicit aliases, alias targets must resolve
directly to valid structural declarations, and application qualified
binding targets must resolve to an owned structural or alias spelling of the selected
instance.

State field value names remain an intentionally open authored namespace. A field may
refer to an owned identity, external parameter, primitive, conventional value type, or
concept-local refinement. Therefore an unresolved field value is retained and
classified as unresolved but is not itself an SSF error. It does not become owned and
cannot be used as a qualified binding target. Action and query signature types are also
not required to occur in State and never contribute ownership.

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
