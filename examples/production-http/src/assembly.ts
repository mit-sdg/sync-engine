import { assemble, type ImplementationOverrides } from "@mit-sdg/sync-engine/assembly";
import { productionHttpConcepts, vocabulary } from "./concept-set.ts";
import * as composition from "./composition.ts";

export type ProductionHttpOverrides = ImplementationOverrides<typeof vocabulary>;

export function assembleProductionHttp(instances: ProductionHttpOverrides = {}) {
  return assemble({
    vocabulary,
    instances: { ...productionHttpConcepts.implementations(), ...instances },
    composition,
  });
}

export type ProductionHttpApp = ReturnType<typeof assembleProductionHttp>;
