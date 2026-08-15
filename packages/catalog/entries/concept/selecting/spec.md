# Selecting

## Purpose

Keep one current item for a shared scope, so everyone working in that scope can
begin from the same choice.

## Principle

A workshop chooses Essay A and it becomes the workshop's current selection.
Later it chooses Essay B; the new selection replaces Essay A as current without
changing another workshop's selection. Clearing the workshop removes its
current selection. A second clear is refused because there is nothing left to
clear.

## Types

```types
external Scope
  The context in which one item is current.
external Item
  The object selected within a scope.
```

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
  where true
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
_current (scope: Scope) : optional (selection: Selection, scope: Scope, item: Item)
  answers no row for a Scope with no current Selection
_get (selection: Selection) : optional (selection: Selection, scope: Scope, item: Item)
  answers no row for an unknown Selection
```
