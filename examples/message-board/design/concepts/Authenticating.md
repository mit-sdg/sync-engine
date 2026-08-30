# Authenticating

## Purpose

Establish a username from a password, so an identity claim alone cannot act as
proof of identity.

## Principle

Ari registers username `ari` with a password. `_registered` then reports `ari`
as registered, and another registration of `ari` is refused.
Authenticating `ari` with the wrong password is refused. The correct password
authenticates Ari, returning the account reference, which is the username `ari`.

## Types

```types
opaque Secret
  A password verifier; its representation is the implementer's choice.
```

## State

```state
a set of Accounts with
  a unique username String
  a salt String
  a passwordVerifier Secret
```

## Actions

```actions
register (username: String, password: String) : return (account: Account)
  where username is not 3 to 32 letters, digits, underscores, or hyphens
  then
    refuse INVALID_USERNAME "A username must contain 3 to 32 letters, numbers, underscores, or hyphens."
  where password is shorter than 8 characters or longer than 128 characters
  then
    refuse WEAK_PASSWORD "A password must contain 8 to 128 characters."
  where username is already registered
  then
    refuse USERNAME_TAKEN "That username is already registered."
  where username and password are accepted
  then
    add a new account with username, a fresh salt, and a verifier derived from password and that salt
    bind account to that account
    return account

authenticate (username: String, password: String) : return (account: Account)
  where username is unknown or password does not verify
  then
    refuse INVALID_CREDENTIALS "The username or password is incorrect."
  where password verifies
  then
    bind account to the verified account
    return account
```

## Queries

```queries
_registered (username: String) : one (registered: Flag)
  answers false for an unknown username
```
