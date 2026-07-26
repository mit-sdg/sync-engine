import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { SelectingConcept, NoCurrentSelection } from "./selecting.ts";
import spec from "./spec.md" with { type: "text" };

export const selecting = registerConcept({
  class: SelectingConcept,
  spec,
  queries: { _current: "optional", _get: "optional" },
  refusals: {
    NO_CURRENT_SELECTION: { error: NoCurrentSelection, on: ["clear"] },
  },
  floors: {
    deterministic: ({ identities }: { identities: { Selecting: () => string } }) =>
      new SelectingConcept(identities.Selecting),
  },
});
