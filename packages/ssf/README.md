# Simple State Form (SSF)

Simple State Form (SSF) is the State language for a concept specification. It is a
small English-like notation for declaring a concept's State. Write one declaration
per line. Put a declaration's fields on the following indented lines.

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

at most one Item has each title
```

## Declarations

The bounded structural grammar is:

```text
schema := (setDecl | subsetDecl)*
setDecl := (a|an) (element|set|seq) [of] Type [with field+]
subsetDecl := (a|an) Subtype (element|set) [of] (Type|Subtype) [with field+]
field := [a|an] [optional] [name] (scalar|collection)
scalar := Type | Parameter | primitive | (of VALUE (or VALUE)+)
collection := (set|seq) [of] scalar
primitive := Number | String | Flag | Date | DateTime
```

A top-level declaration uses `a set of Items`, `a seq of Items`, or
`an element Settings`. The `of` after a structural keyword is optional. A
declaration with fields ends its first line with `with`; each field follows on
its own indented line.

A subset declaration names existing members of a parent:
`a Completed set of Items`. A subset may use `set` or `element`, but not `seq`.
It may declare fields with the same `with` form.

## Fields

A field may have an explicit lowercase name. The name comes before its value
form:

```state
  a title String
  an optional owner Person
  a members set of Person
  a history seq of Event
  a status of OPEN or DONE
```

An indented field may omit its article. `optional` still precedes the field
name. When the field has an article, `optional` immediately follows it, as in
`an optional owner Person`. It does not follow the name.

A field name may be omitted when its value supplies a named type or parameter.
SSF lowercases the first character of that name:

```state
  a Profile
  a set of Options
```

These fields are named `profile` and `options`. Enumerations do not supply an
inferred field name.

A collection field uses `set` or `seq`, with an optional `of`. Its elements are
scalars. Collections cannot contain collections. Named-type unions are not part
of SSF; `or` occurs only between enumeration values. An enumeration has at least
two uppercase values, as in `of OPEN or DONE`.

The primitive spellings are `Number`, `String`, `Flag`, `Date`, and `DateTime`.

## State meaning

A top-level set or sequence introduces identities. An element declaration has
one member. Fields declare relations on those identities. Do not add ID fields
for them. A scalar field relates a member to a scalar value or another identity.
A collection field relates it to a set or sequence of values.

Collections are never optional. An empty collection represents absence. Scalar
fields may be optional.

A subset classifies members already introduced by its parent. It does not
introduce new identities. Subsets may overlap, and subset fields add relations
for the classified members. Which side declares a relation implies nothing
about storage, navigation, or ownership.

## Names and exact spellings

Type, parameter, declaration, subset, and parent names begin with an uppercase
ASCII letter. Field names begin with a lowercase ASCII letter. Their remaining
characters may be ASCII letters, digits, or `_`. Enumeration values use only
uppercase ASCII letters, digits, and `_`, and begin with a letter.

Declaration and subset spellings remain exactly as authored. SSF does not
normalize a declared name to a guessed singular. A collection name gains a
singular or plural spelling only when that exact second spelling is also
authored as a State field type or in an action or query signature of the same
specification.

English inflection, including irregular pairs such as `Mouse` and `Mice`, can
relate those two authored spellings. It never creates a third spelling. With
only `a set of Mice`, the parser does not invent `Mouse`; the second name must
appear in the specification. Element names remain exact even when another
spelling appears elsewhere.

## Opaque prose and malformed structure

A prose line such as `at most one Item has each title` remains opaque text. SSF
does not interpret or prove it.

A line that begins like a declaration or indented field must complete that
structural form. Missing parts, extra trailing words, and other incomplete forms
are malformed rather than opaque. These lines are malformed:

```state
a set of Records with garbage
  a owner
```

## Canonical form

The form check requires top-level declarations to use `a set`, `a seq`, or
`an element`. A subset puts `a` or `an` before its subtype, as in
`a Completed set` or `an Open set`. For a field with an article, the check
requires `optional` immediately after the article and before the field name. The
canonical form is `an optional owner Person`. A collection cannot use
`optional`.

The check also requires `with` before indented fields. The structural keywords
are exactly `set`, `seq`, and `element`. It treats `array`, `list`, `sequence`,
and `sequences` as near misses for `seq`, and `singleton` as a near miss for
`element`.

## Scope

SSF proves bounded structural declarations and the exact owned type names they
evidence. It does not prove invariant prose, define storage, or establish
behavior.
