import { view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Gathering } = concepts;

export const responderMayContribute = view(
  "(responder) may contribute in (room)",
  ({ responder, room }) =>
    where(Gathering._membership({ gathering: room, member: responder }).is({ joined: true })),
);

export const responderMayNotContribute = view(
  "(responder) may not contribute in (room)",
  ({ responder, room }) =>
    where(Gathering._membership({ gathering: room, member: responder }).is({ joined: false })),
);

export const deniedContribution = "RESPONDERS_ONLY";
