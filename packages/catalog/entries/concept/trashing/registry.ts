import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { ItemAlreadyTrashed, ItemNotTrashed, ItemPurged } from "./trashing.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { TrashingMemoryConcept } from "./trashing.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { TrashingMongoConcept } from "./trashing.mongo.ts";
//#endfloor

//#class memory TrashingMemoryConcept
//#class mongo TrashingMongoConcept
export const trashing = registerConcept({
  class: TrashingMemoryConcept, // selected-class
  spec,
  refusals: {
    ITEM_PURGED: ItemPurged,
    ITEM_ALREADY_TRASHED: ItemAlreadyTrashed,
    ITEM_NOT_TRASHED: ItemNotTrashed,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new TrashingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new TrashingMongoConcept(db),
    //#endfloor
  },
});
