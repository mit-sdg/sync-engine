import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { InvalidPostContent } from "./posting.shared.ts";
import spec from "./spec.md" with { type: "text" };
//#floor memory
import { PostingMemoryConcept } from "./posting.memory.ts";
//#endfloor

//#class memory PostingMemoryConcept
export const posting = registerConcept({
  class: PostingMemoryConcept, // selected-class
  spec,
  refusals: { INVALID_POST_CONTENT: InvalidPostContent },
  floors: {
    //#floor memory
    memory: (_context: {}) => new PostingMemoryConcept(),
    //#endfloor
  },
});
