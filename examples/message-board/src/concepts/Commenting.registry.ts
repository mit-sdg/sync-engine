import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { CommentAuthorMismatch, CommentingConcept, CommentNotFound } from "./Commenting.ts";
import spec from "@design/concepts/Commenting.md" with { type: "text" };

export const commenting = registerConcept({
  class: CommentingConcept,
  spec,
  refusals: {
    COMMENT_NOT_FOUND: CommentNotFound,
    COMMENT_AUTHOR_MISMATCH: CommentAuthorMismatch,
  },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new CommentingConcept(identities[name]),
  },
});
