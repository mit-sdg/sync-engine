# Mitigating

## Purpose

Keep the current mitigation for an operations room so responders share one
next move.

## Principle

Checkout latency starts with investigation as its mitigation. Mara chooses a
rollback instead, and the rollback becomes current for that room.

## Types

```types
external Room
  An operations room whose current mitigation is being selected.
```

## State

```state
a set of Selections with
  a room Room
  a mitigation String

a set of Current Selections
```

## Actions

```actions
choose(room: Room, mitigation: String) : returns (selection: Selection)
  where true
  then
    remove any selection with room from Current Selections
    add a new selection with room and mitigation
    add selection to Current Selections
    returns selection
```

## Queries

```queries
_current(room: Room) : optional (selection: Selection, room: Room, mitigation: String)
```
