import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConcepts } from "./concepts.ts";
import * as composition from "./compositions/OperationsRoom.ts";

export function assembleOperationsRoom() {
  return assemble({
    conceptSet: applicationConcepts,
    instances: applicationConcepts.implementations(),
    composition,
  });
}
