import { assemble } from "@mit-sdg/sync-engine/assembly";
import { catalogComposition } from "@catalog/composition";
import { operationsRoomConcepts, vocabulary } from "./concept-set.ts";

export function assembleOperationsRoom() {
  return assemble({
    vocabulary,
    instances: operationsRoomConcepts.implementations(),
    composition: catalogComposition,
  });
}
