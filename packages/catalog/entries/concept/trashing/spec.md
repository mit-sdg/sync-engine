# Trashing

## Purpose

Record a reversible removal before making that removal irreversible, so an accidental
removal can be restored without leaving every removal permanently reversible.

## Principle

Item `post-8` is trashed at `t1` and appears among trashed items. It is restored and no
longer appears there. The item is trashed again and then purged. A later restore and a
later trash are refused because purge is permanent.

## Types

```types
external Item
  The object whose removal disposition is tracked.
```

## State

```state
a set of Dispositions with
  an item Item
  a status DispositionStatus
  an optional trashedAt DateTime
  an optional purgedAt DateTime

Rule: at most one Disposition has each Item
```

## Actions

```actions
trash (item: Item, at: DateTime) : return (item: Item)
  where item has a purged Disposition
  then
    refuse ITEM_PURGED "This item has been permanently purged."
  where item has a trashed Disposition
  then
    refuse ITEM_ALREADY_TRASHED "This item is already trashed."
  where item has no Disposition or an active Disposition
  then
    set its Disposition to trashed with trashedAt at and no purgedAt
    return item

restore (item: Item) : return (item: Item)
  where item has a purged Disposition
  then
    refuse ITEM_PURGED "This item has been permanently purged."
  where item has no Disposition or an active Disposition
  then
    refuse ITEM_NOT_TRASHED "This item is not trashed."
  where item has a trashed Disposition
  then
    set its Disposition to active with no trashedAt or purgedAt
    return item

purge (item: Item, at: DateTime) : return (item: Item)
  where item has a purged Disposition
  then
    refuse ITEM_PURGED "This item has been permanently purged."
  where item has no Disposition or an active Disposition
  then
    refuse ITEM_NOT_TRASHED "This item is not trashed."
  where item has a trashed Disposition
  then
    set its Disposition to purged with purgedAt at
    return item
```

## Queries

```queries
_state (item: Item) : one (status: DispositionStatus)
  answers active when the Item has no Disposition
_trashed () : many (item: Item, trashedAt: DateTime)
  orders rows by trashedAt and then Item identity
```
