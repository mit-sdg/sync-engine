import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { SelectingConcept, NoCurrentSelection } from "./selecting.ts";
import spec from "./spec.md" with { type: "text" };

export const selecting = registerConcept({
  class: SelectingConcept,
  spec,
  refusals: { NO_CURRENT_SELECTION: NoCurrentSelection },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new SelectingConcept(identities[name]),
  },
});
