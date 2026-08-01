import { view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concept-set.ts";

const { Gathering } = concepts;

export const responderMayContribute = view(
  "(responder) may contribute in (room)",
  (inputs, _outputs, _bindings) => {
    const { responder, room } = inputs("responder", "room");
    return where(
      Gathering._membership({ gathering: room, member: responder }).is({ joined: true }),
    );
  },
).holds();

export const responderMayNotContribute = view(
  "(responder) may not contribute in (room)",
  (inputs, _outputs, _bindings) => {
    const { responder, room } = inputs("responder", "room");
    return where(
      Gathering._membership({ gathering: room, member: responder }).is({ joined: false }),
    );
  },
).holds();

export const deniedContribution = "RESPONDERS_ONLY";
