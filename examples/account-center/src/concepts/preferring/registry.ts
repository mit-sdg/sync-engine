import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { PreferringConcept, PreferenceNotFound } from "./preferring.ts";
import spec from "./spec.md" with { type: "text" };

export const preferring = registerConcept({
  class: PreferringConcept,
  spec,
  refusals: { PREFERENCE_NOT_FOUND: PreferenceNotFound },
});
