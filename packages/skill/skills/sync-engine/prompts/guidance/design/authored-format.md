# Authored formats

Write each concept to `design/concepts/<Gerund>.md`, each application composition to `design/compositions/<Name>.md`, and application-owned concrete types to `design/types.md`. These are the only authored-design locations; decomposition remains the work-unit `decomposition.md`.

Each concept has one gerund identifier H1 naming its mechanism (`# Tasking`, never
`# Tasks` or `# Task Management`) and these H2s, in order;
no other headings or fences:

````text
# Tasking

## Purpose
Unfenced prose.

## Principle
Unfenced prose.

## Types
```types
external Person
  Optional explanation.
```

## State
```state
<SSF declarations>
```

## Actions
```actions
create (owner: Person, title: String, dueAt?: DateTime) : return (item: Item)
  where title is valid
  then
    create the item
    return item
  where title is invalid
  then
    refuse INVALID_TITLE "A valid title is required."

delete (item: Item) : return ()
  where true
  then
    delete the item
    return
```

## Queries
```queries
_items (owner: Person) : many (item: Item, title: String)
  answers the owner's items with their titles
  answers no rows when the owner has none
  orders rows by Item identity
```
````

A concept's Types section contains only `external Name` declarations, or is empty. State uses supplied SSF;
keep every State line inside its fence and prefix every invariant prose line with exact
`Rule:`. Actions use `name: Type`, optional `name?: Type`, `: return`, parenthesized named
results, and one or more `where`/`then` branches. Indent `where` and `then` equally and
each branch body deeper. Terminal success returns exactly the declared names. Declare an
empty result `: return ()` and end its branches with bare `return`, never `return ()` or
a standalone `()`. Refuse with `refuse CODE "Normative sentence."`; keep codes unique
within an action and never shared across actions. Return declared names only: `return account`, never prose such as `return the session
account`. A returned name is a declared parameter, the row the branch created or changed,
or a value an earlier line in that branch binds, as in `count the Tallies with subject as
total`. Order an action's branches with its refusals first and its terminal success last,
and give each branch a condition the others cannot also match.

Actions start with a letter; queries start `_` and use `one`, `optional`, or `many`
before the named row. Mark optional State values in the row `field?: Type`. A `one` body
always promises one row; only `optional` may say no row. Write a query body as one line
per fact: what it answers, then the empty or unknown case, then—for `many` alone—its
stable ordering.

```types
concrete Person
  Stable application identity.
```

```instances
instantiate Tasking with
  Owner is Person
instantiate Noting as Notes with
  Task is Tasking.Task
```

Bare `instantiate D` means `instantiate D as D`, for a definition with no external to
bind. Bind every external inline on its own instance, as above.

Concept files carry no application links, endpoint entries, instances, bindings, or
computations.

## Application files

Inventory exact selected static instances in `design/types.md`, whose `concrete`
declarations are application-owned; never declare core-owned `RequestBoundary`. A
definition may have zero or more instances, none carrying its name. Write an alias only as
`alias Alias for Target`, and leave no concrete unused; config checking rejects the rest.
Bindings convey identity only.

Put exact `reaction:`, `view:`, `former:`, and `computation:` links beside prose, never
wildcards. Every selected endpoint is a reaction declaration and therefore needs its own
`reaction:` link, in addition to links for internal reaction trees. It also needs exactly
one boundary declaration in an `endpoints` fence. Cover every selected endpoint, internal
reaction, named view, and former; declare each executable computation once. A composition
document reads as prose carrying its links and endpoint declarations:

````text
Submitting a response [enters the application](reaction:Circle.Reading.AddResponse).

```endpoints
Circle.Reading.AddResponse at /circle/respond
```

Choosing a reading [opens a discussion](reaction:Circle.Reading.SelectedOpensDiscussion)
about it. A circle page shows the circle, its members and that discussion
[as one record](former:Circle.Pages.CirclePage), and only a member
[may respond](view:Circle.Reading.MemberMayRespond).
````

Give each composition document a nonempty H1 and decision prose. An `endpoints` fence
contains declarations only, one per line in exact `Declaration.Identity at /path` form.
The identity is the same module, group, and declaration selected by the endpoint's
`reaction:` link. The portable absolute path is the exact path implementation passes to
`endpoint(...)`. Different endpoint identities may share a path only when they are
intentional alternatives.

Declare each computation once as `name(inputs) : Result`, no space before its inputs, with
an indented body where it is used, or in `design/types.md` when shared, and reference it as
`[normalization](computation:normalizeTitle)`:

```computations
normalizeTitle(raw: String) : String
  Produces the canonical task title used by endpoint adaptation.
```

The endpoint entry fixes the executable endpoint pathname; its `reaction:` link separately
fixes trace identity. Neither prescribes trigger syntax, stage structure, or variable
flow. If either declaration is absent, implementation must not create that endpoint. Do
not add an internal reaction link for a consequence the endpoint-linked declaration may
perform unless separate deferred behavior is an intentional design decision.

An application document does not duplicate endpoint input, return, or refusal listings:
the concept specifications and composition prose own that behavior, and a second copy
drifts from the contracts the checker reads. Transport methods, status codes, headers, and
external route projections remain outside the `endpoints` fence.

`check-design` proves grammar and authored form only. Config checking proves shapes,
bindings, links, endpoint identity/path agreement, computations, and source agreement. Neither proves boundaries, prose truth,
persistence, transactions, authorization, repair, or behavior; review and test.
