# Sessioning

## Purpose

Issue, verify, and end short-lived anonymous sessions without exposing transport
policy or accepting an identity claim.

## Principle

A caller starts a session with a bounded expiry and can use it before that time.
At expiry it is removed and refused, just like an unknown or ended session.
Ending an active session makes it unknown.

## State

```state
a set of Sessions with
  a session Session
  an expiry Time
```

## Actions

```actions
start () : return (session: Session, expiresAt: Time)
  then
    add a new session with an unguessable identity and an expiry
    return session and expiresAt

current (session: Session) : return (active: Flag)
  where session is unknown, ended, or expired
  then
    delete session if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    return active true

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
