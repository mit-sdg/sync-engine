# Sessioning

## Purpose

Keep a short-lived opaque session for an external subject, so temporary access
can end without changing that subject's identity.

## Principle

Ari starts a session for subject `ari`. Before the session expires, `_active`
returns a row whose subject is `ari`, and `current` resolves the session to
`ari`. Ending the session makes it unknown, so another `current` call is
refused. An invented or expired session is refused in the same way, and
`_active` returns no row for it.

## Types

```types
external Subject
  The external identity represented by a session.
```

## State

```state
a set of Sessions with
  a subject Subject
  an expiresAt Time

alias Session for Sessions
```

## Actions

```actions
start (subject: Subject) : return (session: Session, expiresAt: Time)
  where true
  then
    delete every expired session
    add a new opaque session for subject expiring 30 minutes from now
    return session, expiresAt

current (session: Session) : return (subject: Subject)
  where session is unknown, ended, or expired
  then
    delete the session if it is expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    bind subject to the Session's subject
    return subject

end (session: Session) : return (ended: Flag)
  where session is unknown, ended, or expired
  then
    delete the session if it is expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    delete session
    set ended to true
    return ended
```

## Queries

```queries
_active (session: Session) : optional (subject: Subject, expiresAt: Time)
  answers no row for an unknown, ended, or expired Session
  does not delete an expired Session
```
