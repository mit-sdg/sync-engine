# Gathering

## Purpose

Let a host create a named gathering and let people join or leave it, so
belonging is deliberate and visible rather than inferred from activity.

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

a set of Memberships with
  a gathering Gathering
  a member Person
```

At most one membership exists for a given gathering and member. Creating a
gathering creates its host's membership in the same action.

## Actions

```actions
create (name: String, host: Person) : return (gathering: Gathering)
  then
    add a new gathering with name and host
    add a new membership with gathering and member host
    return gathering

join (gathering: Gathering, member: Person) : return (membership: Membership), refuse (message: String)
  where gathering not in gatherings
  then
    refuse "There is no such gathering."
  where gathering in gatherings and some membership has gathering and member
  then
    refuse "This person already belongs to the gathering."
  where gathering in gatherings and no membership has gathering and member
  then
    add a new membership with gathering and member
    return membership

leave (gathering: Gathering, member: Person) : return (membership: Membership), refuse (message: String)
  where gathering not in gatherings
  then
    refuse "There is no such gathering."
  where gathering in gatherings and no membership has gathering and member
  then
    refuse "This person does not belong to the gathering."
  where gathering in gatherings and some membership has gathering and member
  then
    delete that membership
    return membership
```

`_get` answers zero or one row for a gathering. `_members` answers all members
in join order. `_membership` always answers one row saying whether the member
belongs. Gathering does not know why people meet or what they do together.
