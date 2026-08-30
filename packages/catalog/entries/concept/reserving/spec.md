# Reserving

## Purpose

Give one claimant an exclusive claim on a reservable unit, so the same unit is not
promised to competing claimants.

## Principle

Ari reserves resource `slot-9`. Bo's attempt to reserve `slot-9` is refused. Ari
cancels, after which Bo can reserve it. Bo fulfills the reservation, permanently
consuming `slot-9`; another reservation of that resource is refused.

## Types

```types
external Resource
  The reservable unit receiving an exclusive claim.
external Claimant
  The identity holding a reservation.

ReservationStatus is ACTIVE or FULFILLED or RELEASED
  Whether the claim still holds the resource.
```

## State

```state
a set of Reservations with
  a resource Resource
  a claimant Claimant
  a status ReservationStatus
  a reservedAt DateTime
  an optional endedAt DateTime

a Claimed set of Reservations where status is ACTIVE or FULFILLED with
  unique resource
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
_get (reservation: Reservation) : optional (resource: Resource, claimant: Claimant, status: ReservationStatus, reservedAt: DateTime, endedAt?: DateTime)
  answers the Reservation's resource, claimant, status, and reservation and end times
  answers no row for an unknown Reservation
_activeFor (claimant: Claimant) : many (reservation: Reservation, resource: Resource, reservedAt: DateTime)
  answers the Claimant's active Reservations with their resources and reservation times
  answers no rows when the Claimant has no active Reservations
  orders active Reservations by reservedAt and then Reservation identity
```
