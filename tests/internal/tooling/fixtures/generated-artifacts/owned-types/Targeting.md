# Targeting

## Purpose

Create records that another concept can name as semantic targets.

## Principle

Creating a label establishes one record with that label.

## Types

```types

```

## State

```state
a set of Records with
  a label String

a set of Archived Records

alias Entry for Records
```

## Actions

```actions
create(label: String) : returns (record: Record)
  where true
  then
    returns record
```

## Queries

```queries

```
