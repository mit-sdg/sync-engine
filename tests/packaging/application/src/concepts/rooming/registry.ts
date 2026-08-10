import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { RoomingConcept, RoomAlreadyOpen, RoomNotOpen } from "./rooming.ts";
import spec from "./spec.md" with { type: "text" };

export const rooming = registerConcept({
  class: RoomingConcept,
  spec,
  refusals: {
    ROOM_ALREADY_OPEN: RoomAlreadyOpen,
    ROOM_NOT_OPEN: RoomNotOpen,
  },
});
