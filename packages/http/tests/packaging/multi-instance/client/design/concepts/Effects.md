# Effects

## Purpose

Observe successful entry actions as an instance-local surrounding effect.

## Principle

Every successful entry action can be observed, including an idempotent retry.

## Types

```types
external Operation
  The domain operation whose entry action was observed.
```

## State

```state
a seq of Observations with
  an operation Operation
  an entryId String
```

## Actions

```actions
record(operationId: Operation, entryId: String) : returns (recorded: Flag)
  where true
  then
    append an observation
    returns recorded
```

## Queries

```queries

```
