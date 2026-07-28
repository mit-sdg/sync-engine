# Naming

## Purpose

Claim distinct public names.

## Principle

Maya claims atlas once. A second claim of atlas is refused because public names
are unique.

## State

```state
a set of Names with
  a name String
```

## Actions

```actions
claim (name: String) : return (name: String)
  where name in names
  then
    refuse NAME_TAKEN "This name is already claimed."
  where name not in names
  then
    add name
    return name
```
