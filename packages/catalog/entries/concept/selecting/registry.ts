import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { NoCurrentSelection } from "./selecting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { SelectingMemoryConcept } from "./selecting.memory.ts";
//#endfloor

//#class memory SelectingMemoryConcept
export const selecting = registerConcept({
  class: SelectingMemoryConcept, // selected-class
  spec,
  refusals: { NO_CURRENT_SELECTION: NoCurrentSelection },
  floors: {
    //#floor memory
    memory: (_context: {}) => new SelectingMemoryConcept(),
    //#endfloor
  },
});
