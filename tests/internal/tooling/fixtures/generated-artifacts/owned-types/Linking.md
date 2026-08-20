# Linking

## Purpose

Associate one externally supplied target with a link.

## Principle

Linking a target records one link to that target.

## Types

```types
external Target
```

## State

```state
a set of Links with
  a target Target
```

## Actions

```actions
link(target: Target) : return ()
  where true
  then
    return
```

## Queries

```queries

```
