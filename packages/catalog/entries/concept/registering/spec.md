# Registering

## Purpose

Accept each identified occurrence once against a subject, so a report that arrives twice
is recognised as the same one and only genuinely new occurrences reach whatever acts on
them.

## Principle

Visit `v1` is registered against page `p1`. The same visit is reported again after a
timeout and is refused, so nothing downstream treats it as new. Visit `v2` registers and
is new. Deregistering `v1` releases it, and deregistering it again is refused.

## Types

```types
external Subject
  The thing an occurrence is registered against.
external Occurrence
  The identity of one occurrence, distinguishing a repeat report from a new one.
```

## State

```state
a set of Registrations with
  a subject Subject
  a unique occurrence Occurrence
```

## Actions

```actions
register (subject: Subject, occurrence: Occurrence) : returns (registration: Registration)
  where a Registration already has occurrence
  then
    refuses ALREADY_REGISTERED "That occurrence has already been registered."
  where no Registration has occurrence
  then
    add a Registration with subject and occurrence
    returns registration

deregister (occurrence: Occurrence) : returns ()
  where no Registration has occurrence
  then
    refuses NOT_REGISTERED "That occurrence was never registered."
  where a Registration has occurrence
  then
    delete that Registration
    returns
```

## Queries

```queries
_registration (occurrence: Occurrence) : optional (subject: Subject)
  answers the subject the occurrence was registered against
  answers no row when no Registration has occurrence
_registrations (subject: Subject) : many (occurrence: Occurrence)
  answers each occurrence registered against subject
  answers no rows when subject has none
  orders rows by Registration identity
```
