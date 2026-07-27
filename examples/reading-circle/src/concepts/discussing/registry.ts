import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { DiscussingConcept, DiscussionAlreadyOpen, DiscussionNotOpen } from "./discussing.ts";
import spec from "./spec.md" with { type: "text" };

export const discussing = registerConcept({
  class: DiscussingConcept,
  spec,
  refusals: {
    DISCUSSION_ALREADY_OPEN: DiscussionAlreadyOpen,
    DISCUSSION_NOT_OPEN: DiscussionNotOpen,
  },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new DiscussingConcept(identities[name]),
  },
});
