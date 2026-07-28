# Sessioning

## Purpose

Issue, verify, and end short-lived sessions without exposing transport policy.

## Principle

Maya starts a session with a bounded expiry and can use it before that time. At
expiry it is removed and refused, just like an unknown or ended session. Ending
an active session makes it unknown.

## State

```state
a set of Sessions with
  a session Session
  a user Person
  an expiry Time
```

## Actions

```actions
start (user: Person) : return (session: Session, expiresAt: Time, user: Person)
  then
    add a new session for user with an expiry
    return session, expiresAt, and user

current (session: Session) : return (user: Person)
  where session is unknown, ended, or expired
  then
    delete session if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    return its user

end (session: Session) : return (ended: Flag)
  where session is unknown, ended, or expired
  then
    delete session if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    delete that session
    return ended true
```
