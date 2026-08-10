import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { SessioningConcept, UnknownSession } from "./sessioning.ts";
import spec from "./spec.md" with { type: "text" };

export const sessioning = registerConcept({
  class: SessioningConcept,
  spec,
  refusals: { UNKNOWN_SESSION: UnknownSession },
});
