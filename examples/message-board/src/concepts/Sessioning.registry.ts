import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { SessioningConcept, UnknownSession } from "./Sessioning.ts";
import spec from "@design/concepts/Sessioning.md" with { type: "text" };

export const sessioning = registerConcept({
  class: SessioningConcept,
  spec,
  refusals: { UNKNOWN_SESSION: UnknownSession },
});
