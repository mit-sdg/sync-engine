import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlreadyJoined, GatheringNotFound, NotJoined } from "./gathering.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { GatheringMemoryConcept } from "./gathering.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { GatheringMongoConcept } from "./gathering.mongo.ts";
//#endfloor

//#class memory GatheringMemoryConcept
//#class mongo GatheringMongoConcept
export const gathering = registerConcept({
  class: GatheringMemoryConcept, // selected-class
  spec,
  refusals: {
    GATHERING_NOT_FOUND: GatheringNotFound,
    ALREADY_JOINED: AlreadyJoined,
    NOT_JOINED: NotJoined,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new GatheringMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new GatheringMongoConcept(db),
    //#endfloor
  },
});
