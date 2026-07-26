import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { DiscussionAlreadyOpen, DiscussionNotOpen } from "./errors.ts";
import spec from "./spec.md" with { type: "text" };
import { DiscussingConcept } from "./discussing.ts";

export const discussing = registerConcept({
  class: DiscussingConcept,
  spec,
  queries: { _openFor: "optional", _responses: "many" },
  refusals: {
    DISCUSSION_ALREADY_OPEN: { error: DiscussionAlreadyOpen, on: ["open"] },
    DISCUSSION_NOT_OPEN: { error: DiscussionNotOpen, on: ["respond", "close"] },
  },
  floors: {
    deterministic: ({ identities }: { identities: { Discussing: () => string } }) =>
      new DiscussingConcept(identities.Discussing),
  },
});
