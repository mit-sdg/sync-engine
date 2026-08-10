import { trashingConformance } from "./trashing.conformance.ts";
import { TrashingMemoryConcept } from "./trashing.memory.ts";

trashingConformance("memory", () => ({
  concept: new TrashingMemoryConcept(),
  close: () => {},
}));
