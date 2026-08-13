import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { InvalidPostContent, PostingConcept } from "./Posting.ts";
import spec from "@design/concepts/Posting.md" with { type: "text" };

export const posting = registerConcept({
  class: PostingConcept,
  spec,
  refusals: { INVALID_POST_CONTENT: InvalidPostContent },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new PostingConcept(identities[name]),
  },
});
