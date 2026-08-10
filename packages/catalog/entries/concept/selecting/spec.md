# Selecting

## Purpose

Keep one current item for a shared scope, so everyone working in that scope can
begin from the same choice.

## State

```state
a set of Selections with
  a scope Scope
  an item Item

a Current set of Selections
```

## Actions

```actions
choose (scope: Scope, item: Item) : return (selection: Selection)
  then
    remove any selection with scope from current
    add a new selection with scope and item
    add selection to current
    return selection

clear (scope: Scope) : return (selection: Selection)
  where some current selection has scope
  then
    remove that selection from current
    return selection
  where no current selection has scope
  then
    refuse NO_CURRENT_SELECTION "This scope has no current selection."
```

## Queries

```queries
_current (scope: Scope) : optional (selection: Selection, item: Item)
  answers no row for a Scope with no current Selection
_get (selection: Selection) : optional (scope: Scope, item: Item)
  answers no row for an unknown Selection
```

## Types

`Selection` is an identity allocated by Selecting. `Scope` and `Item` are opaque
external identities.
