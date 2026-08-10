import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import {
  DiscussionAlreadyOpen,
  DiscussionNotOpen,
  InvalidResponseText,
} from "./discussing.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { DiscussingMemoryConcept } from "./discussing.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { DiscussingMongoConcept } from "./discussing.mongo.ts";
//#endfloor

//#class memory DiscussingMemoryConcept
//#class mongo DiscussingMongoConcept
export const discussing = registerConcept({
  class: DiscussingMemoryConcept, // selected-class
  spec,
  refusals: {
    DISCUSSION_ALREADY_OPEN: DiscussionAlreadyOpen,
    INVALID_RESPONSE_TEXT: InvalidResponseText,
    DISCUSSION_NOT_OPEN: DiscussionNotOpen,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new DiscussingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new DiscussingMongoConcept(db),
    //#endfloor
  },
});
