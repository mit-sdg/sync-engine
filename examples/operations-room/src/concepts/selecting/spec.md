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

## State

```state
a set of Selections with
  a scope Scope
  an item Item

a Current set of Selections
```

At most one current selection exists in each scope. Past selections remain
identifiable even after another becomes current.

## Actions

```actions
choose (scope: Scope, item: Item) : return (selection: Selection)
  then
    remove any selection with scope from current
    add a new selection with scope and item
    add selection to current
    return selection

clear (scope: Scope) : return (selection: Selection), refuse (message: String)
  where some current selection has scope
  then
    remove that selection from current
    return selection
  where no current selection has scope
  then
    refuse "This scope has no current selection."
```

`_current` answers zero or one row for a scope. `_get` answers zero or one row
for a selection. Selecting treats scopes and items as opaque identities.
