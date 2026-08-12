import { conceptSet } from "@mit-sdg/sync-engine/assembly";
import { mitigating } from "./concepts/mitigating/registry.ts";
import { rooming } from "./concepts/rooming/registry.ts";

export const operationsRoomConcepts = conceptSet({
  Rooming: rooming,
  Mitigating: mitigating,
});

export const { concepts, vocabulary } = operationsRoomConcepts;
