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
sessions: set Session
```

## Actions

```actions
start(user: String) : return (session: String, expiresAt: Date)
  where true
  then
    return session, expiresAt
current(session: String) : return (user: String)
  where true
  then
    return user
```

## Queries

```queries

```
