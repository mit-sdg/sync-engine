import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { MitigatingConcept } from "./mitigating.ts";
import spec from "./spec.md" with { type: "text" };

export const mitigating = registerConcept({
  class: MitigatingConcept,
  spec,
  queries: { _current: "optional" },
});
