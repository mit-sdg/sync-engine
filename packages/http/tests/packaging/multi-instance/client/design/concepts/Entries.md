# Entries

## Purpose

Create durable entries once per domain operation while keeping names unique.

## Principle

An operation returns its original entry when retried. Another operation cannot claim an existing name.

## Types

```types
external Operation
  The domain operation requesting creation.
```

## State

```state
a set of Entries with
  an entryId String
  an operation Operation
  a name String

at most one Entry has each name

alias Entry for Entries
```

## Actions

```actions
create(operationId: Operation, name: String) : return (entryId: String, name: String)
  where operationId identifies an entry with name
  then
    return entryId, name
  where operationId or name belongs to a different entry
  then
    refuse CONFLICT "The operation or name is already committed differently."
  where operationId and name are new
  then
    add an entry for operationId and name
    return entryId, name
```

## Queries

```queries

```
