import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import { InvalidPrincipal, SessioningConcept, UnknownSession } from "./sessioning.ts";
import spec from "./spec.md" with { type: "text" };

export const sessioning = registerConcept({
  class: SessioningConcept,
  spec,
  refusals: {
    INVALID_PRINCIPAL: InvalidPrincipal,
    UNKNOWN_SESSION: UnknownSession,
  },
});
