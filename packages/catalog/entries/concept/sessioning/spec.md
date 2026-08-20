# Sessioning

## Purpose

Keep a short-lived opaque session for an external subject, so temporary access can end
without changing that subject's identity.

## Principle

Ari starts a session for subject `ari`. Before the session expires, `_active` reports
its subject and expiry and `current` resolves it to `ari`. Ending the session makes it
unknown. An invented, ended, or expired session is refused in the same way. A session
expires 30 minutes after it starts and does not extend when used.

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
start (subject: Subject) : return (session: Session, expiresAt: DateTime)
  where true
  then
    add a new opaque Session for subject expiring 30 minutes after the trusted current time
    return session, expiresAt

current (session: Session) : return (subject: Subject)
  where session is unknown, ended, or expired at the trusted current time
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active at the trusted current time
  then
    bind subject to the Session's subject
    return subject

end (session: Session) : return (ended: Flag)
  where session is unknown, ended, or expired at the trusted current time
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active at the trusted current time
  then
    remove the Session from active use
    set ended to true
    return ended
```

## Queries

```queries
_active (session: Session) : optional (subject: Subject, expiresAt: DateTime)
  answers the active Session's Subject and expiry time
  answers no row for an unknown, ended, or expired Session
```
