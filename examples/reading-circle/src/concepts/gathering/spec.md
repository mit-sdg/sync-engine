# Gathering

## Purpose

Let a host create a named gathering and let people join or leave it, so
belonging is an explicit, visible state.

## Principle

Asha creates Saturday Workshop and becomes its first member. Bo joins and appears
among its members. When Bo tries to join again, the gathering refuses the
duplicate. Bo leaves; a second attempt to leave is refused because Bo no longer
belongs. When Cy tries to join an unknown gathering, it is refused because the
gathering does not exist.

## State

```state
a set of Gatherings with
  a name String
  a host Person

a seq of Memberships with
  a gathering Gathering
  a member Person

at most one Membership has each gathering and member pair
```

## Actions

```actions
create (name: String, host: Person) : return (gathering: Gathering)
  then
    add a new gathering with name and host
    add a new membership with gathering and member host
    return gathering

join (gathering: Gathering, member: Person) : return (membership: Membership)
  where gathering not in gatherings
  then
    refuse GATHERING_NOT_FOUND "There is no such gathering."
  where gathering in gatherings and some membership has gathering and member
  then
    refuse ALREADY_JOINED "This person already belongs to the gathering."
  where gathering in gatherings and no membership has gathering and member
  then
    add a new membership with gathering and member
    return membership

leave (gathering: Gathering, member: Person) : return (membership: Membership)
  where gathering not in gatherings
  then
    refuse GATHERING_NOT_FOUND "There is no such gathering."
  where gathering in gatherings and no membership has gathering and member
  then
    refuse NOT_JOINED "This person does not belong to the gathering."
  where gathering in gatherings and some membership has gathering and member
  then
    delete that membership
    return membership
```

## Queries

```queries
_get (gathering: Gathering) : optional (name: String, host: Person)
  answers no row for an unknown Gathering
_members (gathering: Gathering) : many (member: Person)
  answers no rows for an unknown Gathering
  orders rows by when each Person joined
_membership (gathering: Gathering, member: Person) : one (joined: Flag)
  answers false when Person is not a member or Gathering is unknown
```

## Types

`Gathering` and `Membership` are identities allocated by Gathering. `Person` is
an opaque external identity. `String` is owned text. `Flag` is a Boolean value.
