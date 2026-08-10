import { postingConformance } from "./posting.conformance.ts";
import { PostingMemoryConcept } from "./posting.memory.ts";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const value = remaining.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

postingConformance("memory", (identities) => ({
  concept: new PostingMemoryConcept(identityReader(identities)),
  close: () => {},
}));
