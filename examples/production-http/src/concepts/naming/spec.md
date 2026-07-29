# Naming

## Purpose

Reserve distinct non-identity namespace labels.

## Principle

An application reserves atlas once. A second claim of atlas is refused because
namespace labels are unique; the label is not a person's authenticated identity.

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
