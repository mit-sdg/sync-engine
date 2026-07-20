import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { RoomAlreadyOpen, RoomNotOpen } from "./errors.ts";
import { RoomingConcept } from "./rooming.ts";
import spec from "./spec.md" with { type: "text" };

export const rooming = registerConcept({
  class: RoomingConcept,
  spec,
  queries: { _get: "optional" },
  refusals: {
    ROOM_ALREADY_OPEN: { error: RoomAlreadyOpen, on: ["open"] },
    ROOM_NOT_OPEN: { error: RoomNotOpen, on: ["close"] },
  },
});
