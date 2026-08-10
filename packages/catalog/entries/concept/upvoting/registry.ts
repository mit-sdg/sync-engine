import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { AlreadyDownvoted, AlreadyUpvoted, VoteNotFound } from "./upvoting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { UpvotingMemoryConcept } from "./upvoting.memory.ts";
//#endfloor
//#floor mongo
import type { Db } from "mongodb";
import { UpvotingMongoConcept } from "./upvoting.mongo.ts";
//#endfloor

//#class memory UpvotingMemoryConcept
//#class mongo UpvotingMongoConcept
export const upvoting = registerConcept({
  class: UpvotingMemoryConcept, // selected-class
  spec,
  refusals: {
    ALREADY_UPVOTED: AlreadyUpvoted,
    ALREADY_DOWNVOTED: AlreadyDownvoted,
    VOTE_NOT_FOUND: VoteNotFound,
  },
  floors: {
    //#floor memory
    memory: (_context: {}) => new UpvotingMemoryConcept(),
    //#endfloor
    //#floor mongo
    mongo: ({ db }: { db: Db }) => new UpvotingMongoConcept(db),
    //#endfloor
  },
});
