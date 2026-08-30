# Authenticating

## Purpose

Establish a username from a password, so a username claim alone cannot act as proof of
identity and a compromised password can be replaced or removed.

## Principle

Ari registers username `ari` with a password. Another registration of `ari` is refused.
The wrong password cannot authenticate `ari`; the correct password can. Ari changes
the password using the old password, after which the old password fails and the new
one succeeds. Ari unregisters with the current password, and the username is no longer
registered.

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
  where username is not 3 to 32 ASCII letters, digits, underscores, or hyphens
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
    add a new Account with username, a fresh salt, and a verifier derived from password and that salt
    bind account to that Account
    return account

authenticate (username: String, password: String) : return (account: Account)
  where username is unknown or password does not verify
  then
    refuse INVALID_CREDENTIALS "The username or password is incorrect."
  where password verifies
  then
    bind account to the verified Account
    return account

changePassword (username: String, currentPassword: String, newPassword: String) : return (account: Account)
  where newPassword is shorter than 8 characters or longer than 128 characters
  then
    refuse WEAK_PASSWORD "A password must contain 8 to 128 characters."
  where username is unknown or currentPassword does not verify
  then
    refuse INVALID_CREDENTIALS "The username or password is incorrect."
  where currentPassword verifies and newPassword is accepted
  then
    replace the Account salt and verifier using newPassword and a fresh salt
    bind account to that Account
    return account

unregister (username: String, password: String) : return (account: Account)
  where username is unknown or password does not verify
  then
    refuse INVALID_CREDENTIALS "The username or password is incorrect."
  where password verifies
  then
    bind account to the verified Account
    delete that Account
    return account
```

## Queries

```queries
_registered (username: String) : one (registered: Flag)
  answers true when an Account has the username
  answers false for an unknown username
```
