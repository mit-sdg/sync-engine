import { gatheringConformance } from "./gathering.conformance.ts";
import { GatheringMemoryConcept } from "./gathering.memory.ts";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("No deterministic identity remains.");
    return identity;
  };
}

gatheringConformance("memory", (identities) => ({
  concept: new GatheringMemoryConcept(identityReader(identities)),
  close: () => {},
}));
