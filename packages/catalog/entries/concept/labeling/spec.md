# Labeling

## Purpose

Classify an item under several stable names in one scope, so the item can be found
through overlapping categories instead of being placed in one exclusive container.

## Principle

Ari creates labels "urgent" and "customer" in scope `board-1`, applies both to item
`post-8`, and finds the item through either label. Renaming "urgent" to "immediate"
changes the displayed name without losing its assignments. A duplicate name and a
duplicate application are refused. Removing the customer label assignment leaves the
immediate assignment intact.

## State

```state
a set of Labels with
  a scope Scope
  a name String

a set of Applications with
  a label Label
  an item Item

within one Scope each Label name is unique
at most one Application has each label and item pair
```

## Actions

```actions
create (scope: Scope, name: String) : return (label: Label)
  where name is blank or longer than 64 characters
  then
    refuse INVALID_LABEL_NAME "A label name must not be blank and must be at most 64 characters."
  where a Label in scope already has name
  then
    refuse LABEL_NAME_TAKEN "This scope already has a label with that name."
  where name is accepted and unused in scope
  then
    add a new Label with scope and name
    return label

rename (label: Label, name: String) : return (label: Label)
  where label is unknown
  then
    refuse LABEL_NOT_FOUND "There is no such label."
  where name is blank or longer than 64 characters
  then
    refuse INVALID_LABEL_NAME "A label name must not be blank and must be at most 64 characters."
  where another Label in the same Scope has name
  then
    refuse LABEL_NAME_TAKEN "This scope already has a label with that name."
  where label is known and name is accepted and unused
  then
    change the Label name to name
    return label

apply (label: Label, item: Item) : return (label: Label, item: Item)
  where label is unknown
  then
    refuse LABEL_NOT_FOUND "There is no such label."
  where an Application has label and item
  then
    refuse LABEL_ALREADY_APPLIED "This label is already applied to the item."
  where label is known and no Application has label and item
  then
    add a new Application with label and item
    return label and item

remove (label: Label, item: Item) : return (label: Label, item: Item)
  where no Application has label and item
  then
    refuse LABEL_NOT_APPLIED "This label is not applied to the item."
  where an Application has label and item
  then
    delete that Application
    return label and item
```

## Queries

```queries
_get (label: Label) : optional (scope: Scope, name: String)
  answers no row for an unknown Label
_for (scope: Scope, item: Item) : many (label: Label, name: String)
  answers no rows when the Item has no Labels in the Scope
  orders rows by name and then Label identity
_items (label: Label) : many (item: Item)
  answers no rows for an unknown Label or a Label with no Applications
```

## Types

`Label` is an identity allocated by Labeling. `Scope` and `Item` are opaque external
identities. `String` is owned text. Names are case-sensitive and retained exactly.
