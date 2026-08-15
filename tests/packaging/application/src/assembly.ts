import { assemble } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";
import * as composition from "./compositions/OperationsRoom.ts";

export function assembleOperationsRoom() {
  return assemble({
    conceptSet: applicationConceptSet,
    instances: applicationConceptSet.implementations(),
    composition,
  });
}
