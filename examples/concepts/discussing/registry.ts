import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import type { DeterministicFloorContext } from "../../support/deterministic-floor.ts";
import { DiscussionAlreadyOpen, DiscussionNotOpen } from "./errors.ts";
import spec from "./spec.md" with { type: "text" };
import { DiscussingConcept } from "./discussing.ts";

export const discussing = registerConcept({
  class: DiscussingConcept,
  spec,
  refusals: {
    DISCUSSION_ALREADY_OPEN: { error: DiscussionAlreadyOpen, on: ["open"] },
    DISCUSSION_NOT_OPEN: { error: DiscussionNotOpen, on: ["respond", "close"] },
  },
  floors: {
    deterministic: ({ identities }: DeterministicFloorContext) =>
      new DiscussingConcept(identities.Discussing),
  },
});
