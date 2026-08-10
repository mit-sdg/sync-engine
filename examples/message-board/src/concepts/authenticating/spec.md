# Authenticating

## Purpose

Establish a username from a password, so an identity claim alone cannot act as
proof of identity.

## Principle

Ari registers username `ari` with a password. A duplicate registration is
refused. A wrong password is refused. The right password authenticates Ari as
`ari` without revealing the stored password verifier.

## State

```state
a set of Accounts with
  a username Username
  a passwordVerifier Secret
```

## Actions

```actions
register (username: Username, password: Password) : return (username: Username)
  where username is malformed
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
    store a password verifier for username
    return username

authenticate (username: Username, password: Password) : return (username: Username)
  where username is unknown or password does not verify
  then
    refuse INVALID_CREDENTIALS "The username or password is incorrect."
  where password verifies
  then
    return username
```

## Queries

```queries
_registered (username: Username) : one (registered: Flag)
  answers false for an unknown Username
```
