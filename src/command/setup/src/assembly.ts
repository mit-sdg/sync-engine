import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationComposition } from "./composition.ts";
import { applicationConcepts, vocabulary } from "./concept-set.ts";

export function assembleApplication() {
  return assemble({
    vocabulary,
    instances: applicationConcepts.implementations(),
    composition: applicationComposition,
  });
}
