# Sessioning

## Purpose

Issue an opaque session for an external subject with a caller-chosen lifetime, so temporary
access ends without changing that subject's identity.

## Principle

At noon Ari starts session `v1` for subject `ari` with a 20-minute lifetime, so it expires
at 12:20. Asked at 12:10, `_active` answers `ari` and 12:20, and `current` answers `ari`.
Ari ends `v1` at 12:11, after which `current` refuses it. At 12:12 Ari starts `v2` with an
eight-minute lifetime; at 12:20 it is expired and is refused just like an invented session.

## Types

```types
external Subject
  The external identity represented by a session.
```

## State

```state
a set of Sessions with
  a subject Subject
  an expiresAt DateTime
```

## Actions

```actions
start (subject: Subject, lifetime: Number, now: DateTime) : return (session: Session, expiresAt: DateTime)
  where lifetime is not a positive finite number of milliseconds
  then
    refuse INVALID_SESSION_LIFETIME "A session lifetime must be a positive number of milliseconds."
  where lifetime is a positive finite number of milliseconds
  then
    add a new opaque Session for subject with expiresAt lifetime milliseconds after now
    return session, expiresAt

current (session: Session, now: DateTime) : return (subject: Subject)
  where session is unknown or ended, or its expiresAt is at or before now
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session is known and its expiresAt is after now
  then
    bind subject to the Session's subject
    return subject

end (session: Session, now: DateTime) : return (ended: Flag)
  where session is unknown or ended, or its expiresAt is at or before now
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session is known and its expiresAt is after now
  then
    delete the Session
    set ended to true
    return ended
```

## Queries

```queries
_active (session: Session, now: DateTime) : optional (subject: Subject, expiresAt: DateTime)
  answers the active Session's subject and expiresAt when expiresAt is after now
  answers no row for an unknown or ended Session, or when expiresAt is at or before now
```
