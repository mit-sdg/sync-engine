import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { InvalidSessionLifetime, UnknownSession } from "./sessioning.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { SessioningMemoryConcept } from "./sessioning.memory.ts";
//#endfloor

//#class memory SessioningMemoryConcept
export const sessioning = registerConcept({
  class: SessioningMemoryConcept, // selected-class
  spec,
  refusals: {
    INVALID_SESSION_LIFETIME: InvalidSessionLifetime,
    UNKNOWN_SESSION: UnknownSession,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new SessioningMemoryConcept(),
    //#endfloor
  },
});
