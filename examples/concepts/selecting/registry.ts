import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import type { DeterministicFloorContext } from "../../support/deterministic-floor.ts";
import { NoCurrentSelection } from "./errors.ts";
import spec from "./spec.md" with { type: "text" };
import { SelectingConcept } from "./selecting.ts";

export const selecting = registerConcept({
  class: SelectingConcept,
  spec,
  refusals: {
    NO_CURRENT_SELECTION: { error: NoCurrentSelection, on: ["clear"] },
  },
  floors: {
    deterministic: ({ identities }: DeterministicFloorContext) =>
      new SelectingConcept(identities.Selecting),
  },
});
