# Member Reservations recipe

## Purpose

Let current members claim reservable units while Reserving remains the sole owner of
exclusive allocation.

## Concepts

Timing supplies one event time. Gathering supplies current membership. Reserving owns
claims and the one-blocking-reservation invariant.

## Decisions

A claimant must be a Gathering member when requesting a reservation. Membership is an
eligibility snapshot; leaving later does not cancel an existing Reservation.
Cancellation and fulfillment use the authenticated claimant identity when the recipe
is exposed publicly.

## Endpoints

- `ReserveForMember` — `/member-reservations/reserve`
- `CancelMemberReservation` — `/member-reservations/cancel`
- `FulfillMemberReservation` — `/member-reservations/fulfill`
- `GetMemberReservations` — `/member-reservations/get`

## Failure

The membership read may become stale, but it cannot violate Reserving's exclusivity
invariant. Reserving decides competing claims atomically. This recipe performs no
cross-concept rollback.
