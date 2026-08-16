# Exact authored formats

Each concept has one definition-name H1 and exactly these H2s, in order; no other
headings or fences:

````text
# Name

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

Types contains only `external Name` declarations or is empty. State uses supplied SSF.
Actions use `name: Type`, optional `name?: Type`, `: return`, parenthesized named
results, and one or more `where`/`then` branches. `where` and `then` have equal
indentation; each branch body is deeper. Terminal success returns exactly declared
names. Empty results use `: return ()` and bare `return`, never `return ()` or a
standalone `()`. Refusal is `refuse CODE "Normative sentence."`; codes are unique
within an action.

Action names start with a letter; queries start `_`. Query resolution precedes the
named row: `: one (...)`, `: optional (...)`, or `: many (...)`. Mark optional State
values as optional row fields, for example `dueAt?: DateTime`. A `one` body always
promises one row; only `optional` may say no row. Every query body covers its answer,
absence, and deterministic `many` ordering.

Application `design/types.md` uses one `types` fence. Concrete definitions and direct
external bindings have this direction:

```types
concrete Person
  Stable application identity.

Tasking.Owner is Person
Notes.Task is Tasking.Task
```

The binding left side is `SelectedInstance.External`; the right side is a concrete or
selected concept-owned type. Concept files contain no application links or computations.
