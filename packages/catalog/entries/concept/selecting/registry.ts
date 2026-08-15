import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { NoCurrentSelection } from "./selecting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { SelectingMemoryConcept } from "./selecting.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { SelectingMongoConcept } from "./selecting.mongo.ts";
//#endfloor
//#floor postgres
import type { Pool } from "pg";
import { SelectingPostgresConcept } from "./selecting.postgres.ts";
//#endfloor

//#class memory SelectingMemoryConcept
//#class mongo SelectingMongoConcept
//#class postgres SelectingPostgresConcept
export const selecting = registerConcept({
  class: SelectingMemoryConcept, // selected-class
  spec,
  refusals: { NO_CURRENT_SELECTION: NoCurrentSelection },
  floors: {
    //#floor memory
    memory: (_context: {}) => new SelectingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new SelectingMongoConcept(db),
    //#endfloor
    //#floor postgres
    postgres: ({ pool }: { pool: Pool }) => new SelectingPostgresConcept(pool),
    //#endfloor
  },
});
