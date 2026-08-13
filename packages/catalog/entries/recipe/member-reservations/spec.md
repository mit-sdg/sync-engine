# Member Reservations

Current gathering members may claim reservable resources while Reserving remains the sole owner of exclusive allocation.

## Compositions

### Reservations

A claimant may reserve only while currently joined to the named Gathering, then may cancel or fulfill their Reservation. Membership is an eligibility snapshot: leaving does not cancel an existing claim. Reserving decides competing claims atomically, while this recipe performs no cross-concept rollback.

### ReservationLists

A claimant may read their active reservations. A public boundary must bind or authorize claimant identities for every reservation operation.

## Formers

### ActiveReservations

The active reservation read lists one claimant's currently blocking Reservations and their resources.
