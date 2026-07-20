# Mitigating

## Purpose

Keep the current mitigation for an operations room so responders share one
next move.

## Principle

Checkout latency starts with investigation as its mitigation. Mara chooses a
rollback instead, and the rollback becomes current for that room.

## State

```state
a set of Selections with
  a room Room
  a mitigation String

a Current set of Selections
```

## Actions

```actions
choose (room: Room, mitigation: String) : return (selection: Selection)
  then
    remove any selection with room from current
    add a new selection with room and mitigation
    add selection to current
    return selection
```

`_current` answers zero or one current mitigation for a room.
