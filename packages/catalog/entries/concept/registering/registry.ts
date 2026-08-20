import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlreadyRegistered, NotRegistered } from "./registering.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { RegisteringMemoryConcept } from "./registering.memory.ts";
//#endfloor

//#class memory RegisteringMemoryConcept
export const registering = registerConcept({
  class: RegisteringMemoryConcept, // selected-class
  spec,
  refusals: {
    ALREADY_REGISTERED: AlreadyRegistered,
    NOT_REGISTERED: NotRegistered,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new RegisteringMemoryConcept(),
    //#endfloor
  },
});
