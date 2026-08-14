import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConcepts } from "./concepts.ts";

export function assembleApplication() {
  return assemble({
    conceptSet: applicationConcepts,
    composition: {},
  });
}
