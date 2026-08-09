# Profiling

## Purpose

Associate a display name with one stable profile for each external principal, so
applications can present people consistently without treating profile data as
authentication.

## Principle

An opaque external principal creates a profile using the display name `  Mina  `.
Both profile lookup and principal lookup return those exact display-name bytes.
A second profile for that principal is refused without changing the first. Mina
renames the profile and both lookups show the new name. Renaming an unknown
profile with a blank name is refused as not found, because existence takes
precedence over display-name validation during rename.

## State

```state
a set of Profiles with
  a principal Principal
  a displayName String
```

At most one profile exists for each principal. A display name must contain a
non-whitespace character. Its supplied bytes, including surrounding whitespace,
are retained unchanged.

## Actions

```actions
create (principal: Principal, displayName: String) : return (profile: Profile)
  where displayName is empty after trimming
  then
    refuse DISPLAY_NAME_REQUIRED "A display name is required."
  where displayName is not empty after trimming and some profile has principal
  then
    refuse PROFILE_ALREADY_EXISTS "This principal already has a profile."
  where displayName is not empty after trimming and no profile has principal
  then
    add a new profile with principal and the supplied displayName unchanged
    return profile

rename (profile: Profile, displayName: String) : return (profile: Profile)
  where profile not in profiles
  then
    refuse PROFILE_NOT_FOUND "There is no such profile."
  where profile in profiles and displayName is empty after trimming
  then
    refuse DISPLAY_NAME_REQUIRED "A display name is required."
  where profile in profiles and displayName is not empty after trimming
  then
    replace its displayName with the supplied displayName unchanged
    return profile
```

## Queries

```queries
_get (profile: Profile) : optional (principal: Principal, displayName: String)
  answers no row for an unknown Profile
_forPrincipal (principal: Principal) : optional (profile: Profile, displayName: String)
  answers no row for a Principal without a profile
```

Principals are opaque identities supplied by another system. Profiling does not
authenticate a principal, issue credentials, or decide who may act; it only owns
display profile data. Implementations require fresh profile identities between
1 and 128 characters. An invalid or colliding generated identity is an internal
host failure and must leave profile state unchanged. A repository reports
`principal-exists` when both the principal and a valid generated identity
conflict. Invalid generated identities fail before principal-conflict handling.
