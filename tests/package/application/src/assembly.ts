import { assemble } from "@mit-sdg/sync-engine/assembly";
import { operationsRoomConcepts, vocabulary } from "./concept-set.ts";
import * as composition from "./composition.ts";

export function assembleOperationsRoom() {
  return assemble({
    vocabulary,
    instances: operationsRoomConcepts.implementations(),
    composition,
  });
}
