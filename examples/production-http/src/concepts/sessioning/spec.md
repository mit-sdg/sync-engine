# Sessioning

## Purpose

Issue, verify, and end short-lived sessions without exposing transport policy.

## Principle

Maya starts a session and can use it while it is active. An unknown or ended
session is refused. Ending an active session makes it unknown.

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
  where session not in sessions
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session in sessions
  then
    return its user

end (session: Session) : return (ended: Flag)
  where session not in sessions
  then
    refuse UNKNOWN_SESSION "This session is not active."
  where session in sessions
  then
    delete that session
    return ended true
```
