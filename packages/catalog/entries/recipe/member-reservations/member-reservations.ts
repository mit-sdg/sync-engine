import spec from "./spec.md";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, former, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Gathering, Reserving, Timing } = concepts;

const ActiveReservations = former(
  "the active reservations of (claimant)",
  ({ claimant }, { reservation, resource, reservedAt }) =>
    each(Reserving._activeFor({ claimant }).is({ reservation, resource, reservedAt })).form({
      reservation,
      resource,
      reservedAt,
    }),
);

/**
 * `claimant` is an identity claim at this boundary. A public adapter must bind it
 * to the authenticated caller rather than trust a caller-selected value.
 */
const ReserveForMember = endpoint(
  "/member-reservations/reserve",
  ({ gathering, resource, claimant, at, reservation }) =>
    receive({ gathering, resource, claimant }).then(
      where(
        Gathering._membership({ gathering, member: claimant }).is({ joined: true }),
        Timing._now({}).is({ time: at }),
      )
        .then(Reserving.reserve({ resource, claimant, at }).responds({ reservation }))
        .then(respond({ reservation }))
        .named("member"),
      where(Gathering._membership({ gathering, member: claimant }).is({ joined: false }))
        .then(respond({ error: "NOT_A_MEMBER" }))
        .named("non-member"),
    ),
);

/** `claimant` must be supplied from the authenticated caller at a public boundary. */
const CancelMemberReservation = endpoint(
  "/member-reservations/cancel",
  ({ reservation, claimant, at }) =>
    receive({ reservation, claimant })
      .where(Timing._now({}).is({ time: at }))
      .then(Reserving.cancel({ reservation, claimant, at }).responds({ reservation }))
      .then(respond({ reservation })),
);

/** `claimant` must be supplied from the authenticated caller at a public boundary. */
const FulfillMemberReservation = endpoint(
  "/member-reservations/fulfill",
  ({ reservation, claimant, at }) =>
    receive({ reservation, claimant })
      .where(Timing._now({}).is({ time: at }))
      .then(Reserving.fulfill({ reservation, claimant, at }).responds({ reservation }))
      .then(respond({ reservation })),
);

/** `claimant` selects whose reservations are read; authenticate or authorize that identity. */
const GetMemberReservations = endpoint("/member-reservations/get", ({ claimant }) =>
  receive({ claimant }).then(respond({ reservations: ActiveReservations({ claimant }) })),
);

export { spec };

export const compositions = {
  Reservations: { ReserveForMember, CancelMemberReservation, FulfillMemberReservation },
  ReservationLists: { GetMemberReservations },
};
export const formers = { ActiveReservations };
