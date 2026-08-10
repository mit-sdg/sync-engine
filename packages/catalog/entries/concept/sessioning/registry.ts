import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { UnknownSession } from "./sessioning.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { SessioningMemoryConcept } from "./sessioning.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { SessioningMongoConcept } from "./sessioning.mongo.ts";
//#endfloor

//#class memory SessioningMemoryConcept
//#class mongo SessioningMongoConcept
export const sessioning = registerConcept({
  class: SessioningMemoryConcept, // selected-class
  spec,
  refusals: { UNKNOWN_SESSION: UnknownSession },
  floors: {
    //#floor memory
    memory: (_context: {}) => new SessioningMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new SessioningMongoConcept(db),
    //#endfloor
  },
});
