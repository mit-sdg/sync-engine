# Timing

## Purpose

Expose the host's current wall-clock time as an explicit value, so one application
rule can bind an instant and pass it consistently to every effect it triggers.

## Principle

When the configured reader supplies DateTime `t1`, `_now` answers `t1`. A caller can
reuse that returned value for every effect that belongs to the same event. After the
reader advances to `t2`, a later uncached evaluation answers `t2`.

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
