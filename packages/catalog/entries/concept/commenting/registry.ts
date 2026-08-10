import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { CommentAuthorMismatch, CommentNotFound, InvalidCommentText } from "./commenting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { CommentingMemoryConcept } from "./commenting.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { CommentingMongoConcept } from "./commenting.mongo.ts";
//#endfloor

//#class memory CommentingMemoryConcept
//#class mongo CommentingMongoConcept
export const commenting = registerConcept({
  class: CommentingMemoryConcept, // selected-class
  spec,
  refusals: {
    INVALID_COMMENT_TEXT: InvalidCommentText,
    COMMENT_NOT_FOUND: CommentNotFound,
    COMMENT_AUTHOR_MISMATCH: CommentAuthorMismatch,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new CommentingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new CommentingMongoConcept(db),
    //#endfloor
  },
});
