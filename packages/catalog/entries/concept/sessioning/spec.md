# Sessioning

## Purpose

Own short-lived opaque credentials that bind a principal to a server-side
session, including atomic rotation and account-wide revocation.

## Principle

Mina starts two sessions with absolute expiries. Each returns Mina's principal
while active. Rotating one first validates a fresh credential, then atomically
replaces the old session; the old credential becomes unknown while the other
session remains active. Ending all Mina's sessions reports the number revoked.
Unknown, ended, and expired sessions have one refusal, and expiry observation
removes owner state. Invalid or colliding generated replacements leave the old
session active.

## State

```state
a set of Sessions with
  a session Session
  a principal Principal
  an expiry Time
```

Each session identifies exactly one principal and absolute expiry. A principal
may have many active sessions. The owner may maintain a principal index, but the
session records and index must change atomically.

## Actions

```actions
start (principal: Principal) : return (session: Session, expiresAt: Time)
  where principal is not a string between 1 and 128 characters
  then
    refuse INVALID_PRINCIPAL "The principal is malformed."
    leave state unchanged
  where principal is valid
  then
    add a fresh session for principal with an absolute expiry
    return session and expiresAt

current (session: Session) : return (principal: Principal, expiresAt: Time)
  where session is unknown, ended, malformed, or expired
  then
    delete session and its index entry if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    return its principal and expiresAt

rotate (session: Session) : return (replacement: Session, expiresAt: Time, principal: Principal)
  where session is unknown, ended, malformed, or expired
  then
    delete session and its index entry if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    validate a fresh non-colliding replacement before removing session
    atomically replace session with replacement for the same principal and a new absolute expiry
    return replacement, expiresAt, and principal

end (session: Session) : return (ended: Flag)
  where session is unknown, ended, malformed, or expired
  then
    delete session and its index entry if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    delete session and its principal index entry
    return ended true

endAll (principal: Principal) : return (endedCount: Number)
  where principal is not a string between 1 and 128 characters
  then
    refuse INVALID_PRINCIPAL "The principal is malformed."
    leave state unchanged
  where principal is valid
  then
    remove every active session for principal and clean its expired sessions
    return endedCount as the number of active sessions removed
```

The default lifetime is 30 minutes. An injected lifetime is a finite integer
from 1 millisecond through 24 hours. Principals and generated session
credentials contain 1 to 128 UTF-16 code units. An invalid clock, impossible
expiry, invalid generated credential, or credential collision is an internal
host failure. Rotation checks that failure before invalidating the old session.

The memory variant is explicitly process-local and loses all sessions on
restart. Its cryptographically random default credentials, clock, and lifetime
are injectable implementation seams, not changes to session semantics. This
concept authenticates possession of its opaque session only; it does not decide
what the principal may do or define browser cookie policy.
