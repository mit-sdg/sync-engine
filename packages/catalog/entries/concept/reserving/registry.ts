import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { ReservationNotActiveForClaimant, ResourceUnavailable } from "./reserving.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { ReservingMemoryConcept } from "./reserving.memory.ts";
//#endfloor

//#class memory ReservingMemoryConcept
export const reserving = registerConcept({
  class: ReservingMemoryConcept, // selected-class
  spec,
  refusals: {
    RESOURCE_UNAVAILABLE: ResourceUnavailable,
    RESERVATION_NOT_ACTIVE_FOR_CLAIMANT: ReservationNotActiveForClaimant,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new ReservingMemoryConcept(),
    //#endfloor
  },
});
