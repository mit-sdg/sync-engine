import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConcepts, vocabulary } from "./vocabulary.ts";

export function assembleApplication() {
  return assemble({
    vocabulary,
    instances: applicationConcepts.implementations(),
    composition: {},
  });
}
