# Timing

## Purpose

Expose the host's current wall-clock time as an explicit value, so one application
rule can bind an instant and pass it consistently to every effect it triggers.

## State

```state
a read function
  read () -> DateTime
```

## Queries

```queries
_now () : one (time: DateTime)
  answers one DateTime obtained from the configured reader
```

## Types

`DateTime` is an absolute wall-clock instant.
