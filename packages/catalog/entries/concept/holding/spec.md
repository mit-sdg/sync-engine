# Holding

## Purpose

Hold long-running work until its operator asks the process to stop, so the work can
clean up instead of being terminated in the middle of an application transition.

## Principle

Ada starts a hold. It remains pending while she leaves the process alone. She
requests an interrupt; the hold is released, returns `interrupt`, and leaves no
process listener behind. A later hold waits independently and returns `terminate`
when she makes that request.

## Types

```types

```

## State

```state
a set of Holds with
  state Holding or Released
  optional reason Interrupt or Terminate
```

Released Holds remain available for inspection. Each active Hold owns its listener
cleanup independently.

## Actions

```actions
awaitStop () : return (hold: Hold, reason: StopReason)
  where true
  then
    add a holding Hold and install independent interrupt and terminate listeners
    if listener setup faults, remove the attempted Hold and propagate the host fault
    wait for the first request, release the Hold, and remove its listeners
    return hold, reason
```

## Queries

```queries
_hold (hold: Hold) : optional (state: HoldState, reason: StopReason | null)
  Returns no row for an unknown Hold. A known Hold remains visible after release;
  reason is null only while it is holding.

_holding () : one (holding: NonnegativeInteger)
  Returns the number of Holds still waiting for an operator request.
```
