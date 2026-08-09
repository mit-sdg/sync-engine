# Authenticating

## Purpose

Associate an exact identifier with an opaque principal and a secret digest, so
an application can verify identifier-and-secret credentials without retaining
plaintext secrets or assigning profile meaning to the identifier.

## Principle

Mina registers one bounded identifier and secret and receives a fresh principal.
Repeating registration with the exact identifier and secret returns that same
principal without changing state, so interrupted composition can resume. A
different secret for the identifier is refused. The exact identifier and
correct secret authenticate that principal. An unknown identifier, a wrong
secret, and a malformed presented secret all produce the same refusal. Changing
the secret first verifies the current credential and
atomically replaces only its digest; the old secret then has the same generic
failure. Duplicate registration, malformed values, codec failures, and invalid
or colliding generated principals leave the existing record unchanged.

## State

```state
a set of Credentials with
  an identifier Identifier
  a principal Principal
  a secretDigest String
```

There is exactly one credential record for an identifier and at most one record
for a principal. Identifiers are retained and compared byte-for-byte. They are
not email addresses and receive no case folding, trimming, or normalization.
Secret digests are codec output; plaintext secrets are never retained in state.

## Actions

```actions
register (identifier: Identifier, secret: Secret) : return (principal: Principal)
  where identifier is not a non-whitespace string between 1 and 128 characters
  then
    refuse INVALID_IDENTIFIER "The identifier is malformed."
    leave state unchanged
  where identifier is valid and secret is not a string between 8 and 1024 characters
  then
    refuse INVALID_SECRET "The secret is malformed."
    leave state unchanged
  where identifier and secret are valid and identifier is already registered with a different secret
  then
    refuse IDENTIFIER_ALREADY_REGISTERED "The identifier is already registered."
    leave state unchanged
  where identifier and secret match an existing credential
  then
    return its principal
    leave state unchanged
  where identifier and secret are valid and identifier is not registered
  then
    add a credential with the exact identifier, a fresh principal, and the secret digest
    return principal

authenticate (identifier: Identifier, secret: Secret) : return (principal: Principal)
  where identifier is unknown or malformed, or secret is wrong or malformed
  then
    perform a bounded secret-codec verification
    refuse INVALID_CREDENTIALS "The identifier or secret is invalid."
    leave state unchanged
  where identifier and secret match a credential
  then
    return its principal

changeSecret (identifier: Identifier, currentSecret: Secret, newSecret: Secret) : return (principal: Principal)
  where newSecret is not a string between 8 and 1024 characters
  then
    refuse INVALID_SECRET "The new secret is malformed."
    leave state unchanged
  where newSecret is valid and identifier is unknown or malformed, or currentSecret is wrong or malformed
  then
    perform a bounded secret-codec verification
    refuse INVALID_CREDENTIALS "The identifier or secret is invalid."
    leave state unchanged
  where newSecret is valid and the current credential matches
  then
    atomically replace its secret digest with the digest of newSecret
    return principal
```

Identifiers must contain a non-whitespace character and contain 1 to 128 UTF-16
code units. Secrets contain 8 to 1024 UTF-16 code units. New-secret validation
precedes current-credential verification. Registration validates identifier,
then secret, then existing-credential verification before requesting a
principal.

The memory variant is explicitly process-local and loses every credential on
restart. It provides a synchronous Node `scrypt` codec with random salts and
constant-time digest comparison as its dependency-free default. Applications
may inject another synchronous codec while preserving the generic failure and
atomic replacement contract. Unknown identifiers and malformed presented
credentials use a dummy digest verification path to reduce identifier-dependent
timing distinction; this is not a complete timing-equality guarantee.

Generated principals must be fresh strings between 1 and 128 characters. An
invalid or colliding generated principal, malformed codec digest, or codec fault
is an internal host failure and leaves credential state unchanged.
