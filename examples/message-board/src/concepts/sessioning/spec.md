# Sessioning

## Purpose

Keep a short-lived opaque session for an external subject, so temporary access
can end without changing that subject's identity.

## Principle

Ari starts a session for subject `ari`. Before its expiry, the session resolves
to `ari`. Ending it makes it unknown. An invented or expired session is also
refused and does not resolve to a subject.

## State

```state
a set of Sessions with
  a subject Subject
  an expiresAt Time
```

## Actions

```actions
start (subject: Subject) : return (session: Session, expiresAt: Time)
  then
    add a new opaque session for subject with a bounded expiry
    return session and expiresAt

current (session: Session) : return (subject: Subject)
  where session is unknown, ended, or expired
  then
    delete session if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    return its subject

end (session: Session) : return (ended: Flag)
  where session is unknown, ended, or expired
  then
    delete session if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    delete session
    return ended true
```

## Queries

```queries
_active (session: Session) : optional (subject: Subject, expiresAt: Time)
  answers no row for an unknown, ended, or expired Session
  does not delete an expired Session
```

## Types

`Subject` is a generic external identity. Sessioning stores it without creating
or interpreting it.
