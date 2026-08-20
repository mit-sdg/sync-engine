# Sessioning

## Purpose

Maintain sign-in sessions.

## Principle

Starting a session permits its current user to be read.

## Types

```types

```

## State

```state
a set of Sessions with
  a user String
  an expiresAt Date
```

## Actions

```actions
start(user: String) : return (session: Session, expiresAt: Date)
  where true
  then
    return session, expiresAt
current(session: Session) : return (user: String)
  where true
  then
    return user
```

## Queries

```queries

```
