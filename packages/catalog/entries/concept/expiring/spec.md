# Expiring

## Purpose

Record a deadline for a subject and answer whether it has lapsed at a given instant, so
lapsing happens by the passing of time alone and needs no action from anyone.

## Principle

Invitation `i1` is given a deadline of noon. Asked at eleven it has not lapsed; asked at
one it has, without anyone having acted. Its deadline moves to two, so at one it has not
lapsed again. Cancelling leaves `i1` with no deadline. A subject that never had a deadline
has not lapsed either: absence of a deadline is not expiry.

## Types

```types
external Subject
  The thing that stops being current once its deadline passes.
```

## State

```state
a set of Deadlines with
  a unique subject Subject
  an expiresAt DateTime
```

## Actions

```actions
schedule (subject: Subject, expiresAt: DateTime, now: DateTime) : return (subject: Subject)
  where a Deadline already has subject
  then
    refuse ALREADY_SCHEDULED "That subject already has a deadline."
  where no Deadline has subject and expiresAt is not after now
  then
    refuse DEADLINE_IN_PAST "A deadline must fall after the current instant."
  where no Deadline has subject and expiresAt is after now
  then
    add a Deadline with subject and expiresAt
    return subject

reschedule (subject: Subject, expiresAt: DateTime, now: DateTime) : return (subject: Subject)
  where no Deadline has subject
  then
    refuse NO_DEADLINE "That subject has no deadline."
  where a Deadline has subject and expiresAt is not after now
  then
    refuse DEADLINE_IN_PAST "A deadline must fall after the current instant."
  where a Deadline has subject and expiresAt is after now
  then
    change that Deadline to expiresAt
    return subject

cancel (subject: Subject) : return (subject: Subject)
  where no Deadline has subject
  then
    refuse NO_DEADLINE "That subject has no deadline."
  where a Deadline has subject
  then
    delete that Deadline
    return subject
```

## Queries

```queries
_deadline (subject: Subject) : optional (expiresAt: DateTime)
  answers the expiresAt of the Deadline with subject
  answers no row when no Deadline has subject
_lapsed (subject: Subject, now: DateTime) : one (lapsed: Flag)
  answers true when the subject's deadline is at or before now
  answers false when the subject's deadline is after now
  answers false when no Deadline has subject
```
