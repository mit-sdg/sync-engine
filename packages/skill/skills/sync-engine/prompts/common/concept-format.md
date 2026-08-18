# Exact authored formats

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
create(owner: Person, title: String, dueAt?: DateTime) : return (item: Item)
  where title is valid
  then
    create the item
    return item
  where title is invalid
  then
    refuse INVALID_TITLE "A valid title is required."

delete(item: Item) : return ()
  where true
  then
    delete the item
    return
```

## Queries
```queries
_items(owner: Person) : many (item: Item, title: String)
  Returns the owner's items, returns no rows when none exist, and orders by Item identity.
```
````

Types contains only `external Name` declarations or is empty. State uses supplied SSF;
prefix every invariant prose line with exact `Rule:`.
Actions use `name: Type`, optional `name?: Type`, `: return`, parenthesized named
results, and one or more `where`/`then` branches. `where` and `then` have equal
indentation; each branch body is deeper. Terminal success returns exactly declared
names. Empty-result signatures declare `: return ()`; branch bodies use bare `return`, never
`return ()` or standalone `()`. Refusal is `refuse CODE "Normative sentence."`; codes are unique
within an action and never shared across actions. Return declared names only:
`return account`, never prose such as `return the session account`.

Actions start with a letter; queries start `_` and use `one`, `optional`, or `many`
before the named row. Mark optional State values in the row `field?: Type`. A `one` body
always
promises one row; only `optional` may say no row.

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

Bare `instantiate D` means `instantiate D as D`. Declare each selected instance once
except `RequestBoundary`; bind all externals inline or all detached:

```instances
instantiate Tasking
instantiate Noting as Notes
```

```bindings
Tasking.Owner is Person
Notes.Task is Tasking.Task
```

Do not mix placement. Targets are concrete or SSF-owned types; external
aliases are invalid and direct owned-type cycles valid. Concept files contain no application links, instances, bindings, or computations.

Each composition document has nonempty H1 and decision prose. References are
Markdown links to application declarations—not bare `view:` lines, routes, or
concept actions:

```md
Editing [refreshes content](reaction:Forum.posts.RefreshDerivedContent).
The [home feed](former:Forum.feed.HomeFeed) presents selected posts.
Visibility follows the [readability policy](view:Forum.posts.Readable).
```

Declare each computation once with an indented body where used, or in
`design/types.md` when shared:

```computations
normalizeTitle(raw: String) : String
  Produces the canonical task title used by endpoint adaptation.
```

Prose may use `[normalization](computation:normalizeTitle)`. Routes stay in prose; link
targets are exact dotted source paths.
