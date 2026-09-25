# Faulting

## Purpose

Exercise an unexpected fault after an earlier domain action commits.

## Principle

A requested fault throws rather than returning a domain refusal.

## Types

```types
external Operation
  The domain operation that requests the fault.
```

## State

```state
Rule: no durable state
```

## Actions

```actions
crash(operationId: Operation) : returns (reached: Flag)
  where true
  then
    attempt the requested fault
    returns reached
```

## Queries

```queries

```
