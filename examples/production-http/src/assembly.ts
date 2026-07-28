import { assemble } from "@mit-sdg/sync-engine/assembly";
import { productionHttpConcepts, vocabulary } from "./concept-set.ts";
import * as composition from "./composition.ts";

export function assembleProductionHttp() {
  return assemble({
    vocabulary,
    instances: productionHttpConcepts.implementations(),
    composition,
  });
}

export type ProductionHttpApp = ReturnType<typeof assembleProductionHttp>;
