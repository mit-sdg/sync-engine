import { selectingConformance } from "./selecting.conformance.ts";
import { SelectingMemoryConcept } from "./selecting.memory.ts";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("No deterministic identity remains.");
    return identity;
  };
}

selectingConformance("memory", (identities) => ({
  concept: new SelectingMemoryConcept(identityReader(identities)),
  close: () => {},
}));
