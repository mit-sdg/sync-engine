import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlreadyScheduled, DeadlineInPast, NoDeadline } from "./expiring.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { ExpiringMemoryConcept } from "./expiring.memory.ts";
//#endfloor

//#class memory ExpiringMemoryConcept
export const expiring = registerConcept({
  class: ExpiringMemoryConcept, // selected-class
  spec,
  refusals: {
    ALREADY_SCHEDULED: AlreadyScheduled,
    DEADLINE_IN_PAST: DeadlineInPast,
    NO_DEADLINE: NoDeadline,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new ExpiringMemoryConcept(),
    //#endfloor
  },
});
