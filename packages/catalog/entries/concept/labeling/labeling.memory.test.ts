import { labelingConformance } from "./labeling.conformance.ts";
import { LabelingMemoryConcept } from "./labeling.memory.ts";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const value = remaining.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

labelingConformance("memory", (identities) => ({
  concept: new LabelingMemoryConcept(identityReader(identities)),
  close: () => {},
}));
