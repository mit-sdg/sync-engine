import { view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Gathering } = concepts;

export const responderMayContribute = view(
  "(responder) may contribute in (room)",
  ({ responder, room }) => where(Gathering._get({ gathering: room }).is({ host: responder })),
);

export const responderMayNotContribute = view(
  "(responder) may not contribute in (room)",
  ({ responder, room }) => where(Gathering._get({ gathering: room }).is.not({ host: responder })),
);

export const deniedContribution = "HOST_ONLY";
