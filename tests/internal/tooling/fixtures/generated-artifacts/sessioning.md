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
start(user: String) : returns (session: Session, expiresAt: Date)
  where true
  then
    returns session, expiresAt
current(session: Session) : returns (user: String)
  where true
  then
    returns user
```

## Queries

```queries

```
