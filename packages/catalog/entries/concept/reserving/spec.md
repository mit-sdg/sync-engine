# Reserving

## Purpose

Give one claimant an exclusive claim on a reservable unit, so the same unit is not
promised to competing claimants.

## State

```state
a set of Reservations with
  a resource Resource
  a claimant Claimant
  a status ReservationStatus
  a reservedAt DateTime
  an endedAt optional DateTime

at most one active or fulfilled Reservation has each Resource
```

## Actions

```actions
reserve (resource: Resource, claimant: Claimant, at: DateTime) : return (reservation: Reservation)
  where an active or fulfilled Reservation has resource
  then
    refuse RESOURCE_UNAVAILABLE "This resource is not available."
  where no active or fulfilled Reservation has resource
  then
    add a new active Reservation with resource, claimant, and reservedAt at
    return reservation

cancel (reservation: Reservation, claimant: Claimant, at: DateTime) : return (reservation: Reservation)
  where reservation is unknown, is not active, or does not have claimant
  then
    refuse RESERVATION_NOT_ACTIVE_FOR_CLAIMANT "There is no such active reservation for this claimant."
  where reservation is active and has claimant
  then
    mark the Reservation cancelled with endedAt at
    return reservation

fulfill (reservation: Reservation, claimant: Claimant, at: DateTime) : return (reservation: Reservation)
  where reservation is unknown, is not active, or does not have claimant
  then
    refuse RESERVATION_NOT_ACTIVE_FOR_CLAIMANT "There is no such active reservation for this claimant."
  where reservation is active and has claimant
  then
    mark the Reservation fulfilled with endedAt at
    return reservation
```

## Queries

```queries
_blocking (resource: Resource) : optional (reservation: Reservation, claimant: Claimant, status: ReservationStatus, reservedAt: DateTime)
  answers the active or fulfilled Reservation for the Resource
  answers no row when the Resource is available
_get (reservation: Reservation) : optional (resource: Resource, claimant: Claimant, status: ReservationStatus, reservedAt: DateTime, endedAt: DateTime | undefined)
  answers no row for an unknown Reservation
_activeFor (claimant: Claimant) : many (reservation: Reservation, resource: Resource, reservedAt: DateTime)
  orders active Reservations by reservedAt and then Reservation identity
```

## Types

`Reservation` is an identity allocated by Reserving. `Resource` and `Claimant` are
opaque external identities. `ReservationStatus` is `active`, `cancelled`, or
`fulfilled`. `DateTime` is an absolute instant.
