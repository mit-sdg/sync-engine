import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";

export function assembleApplication() {
  return assemble({
    conceptSet: applicationConceptSet,
    composition: {},
  });
}
