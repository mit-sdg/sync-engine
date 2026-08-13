import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Selecting.md" with { type: "text" };
import { SelectingConcept, NoCurrentSelection } from "./Selecting.ts";

export const selecting = registerConcept({
  class: SelectingConcept,
  spec,
  refusals: { NO_CURRENT_SELECTION: NoCurrentSelection },
  floors: {
    deterministic: ({ identities }: { identities: Record<string, () => string> }, name: string) =>
      new SelectingConcept(identities[name]),
  },
});
