import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { naming } from "./concepts/naming/registry.ts";
import { sessioning } from "./concepts/sessioning/registry.ts";

export const productionHttpConcepts = conceptSet({
  Naming: naming,
  Sessioning: sessioning,
});

export const { concepts, vocabulary } = productionHttpConcepts;
