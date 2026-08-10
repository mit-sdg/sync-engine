# Sessioning

## Purpose

Keep a short-lived opaque session for an external subject, so temporary access can end
without changing that subject's identity.

## Principle

Ari starts a session for subject `ari`. Before the session expires, `_active` reports
its subject and expiry and `current` resolves it to `ari`. Ending the session makes it
unknown. An invented, ended, or expired session is refused in the same way. A session
expires 30 minutes after it starts and does not extend when used.

## State

```state
a set of Sessions with
  a subject Subject
  an expiresAt DateTime
```

## Actions

```actions
start (subject: Subject) : return (session: Session, expiresAt: DateTime)
  then
    add a new opaque Session for subject expiring 30 minutes after the trusted current time
    return session and expiresAt

current (session: Session) : return (subject: Subject)
  where session is unknown, ended, or expired at the trusted current time
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active at the trusted current time
  then
    return its subject

end (session: Session) : return (ended: Flag)
  where session is unknown, ended, or expired at the trusted current time
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active at the trusted current time
  then
    remove the Session from active use
    return ended true
```

## Queries

```queries
_active (session: Session) : optional (subject: Subject, expiresAt: DateTime)
  answers no row for an unknown, ended, or expired Session
```

## Types

`Session` is an unguessable bearer value allocated by Sessioning. `Subject` is an
opaque external identity. `DateTime` is an absolute instant. `Flag` is a Boolean
value.
