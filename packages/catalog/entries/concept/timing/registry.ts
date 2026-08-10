import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "./spec.md" with { type: "text" };
import { TimingConcept } from "./timing.ts";

//#class memory TimingConcept
//#class mongo TimingConcept
export const timing = registerConcept({
  class: TimingConcept, // selected-class
  spec,
  floors: {
    //#floor memory
    memory: (_context: {}) => new TimingConcept(),
    //#endfloor
    //#floor mongo
    mongo: (_context: {}) => new TimingConcept(),
    //#endfloor
  },
});
