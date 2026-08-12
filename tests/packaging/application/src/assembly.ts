import { assemble } from "@mit-sdg/sync-engine/assembly";
import { operationsRoomConcepts, vocabulary } from "./vocabulary.ts";
import * as composition from "./compositions/OperationsRoom.ts";

export function assembleOperationsRoom() {
  return assemble({
    vocabulary,
    instances: operationsRoomConcepts.implementations(),
    composition,
  });
}
