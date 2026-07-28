import { PublicError, registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "./spec.md" with { type: "text" };
import { SessioningConcept, UnknownSession } from "./sessioning.ts";

export const sessioning = registerConcept({
  class: SessioningConcept,
  spec,
  refusals: { UNKNOWN_SESSION: UnknownSession },
  publicErrors: { UNKNOWN_SESSION: PublicError.UNAUTHORIZED },
});
