import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "./spec.md" with { type: "text" };
import { NothingTallied } from "./tallying.shared.ts";
//#floor memory
import { TallyingMemoryConcept } from "./tallying.memory.ts";
//#endfloor

//#class memory TallyingMemoryConcept
export const tallying = registerConcept({
  class: TallyingMemoryConcept, // selected-class
  spec,
  refusals: {
    NOTHING_TALLIED: NothingTallied,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new TallyingMemoryConcept(),
    //#endfloor
  },
});
