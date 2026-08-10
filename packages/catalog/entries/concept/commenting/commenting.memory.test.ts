import { commentingConformance } from "./commenting.conformance.ts";
import { CommentingMemoryConcept } from "./commenting.memory.ts";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const value = remaining.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

commentingConformance("memory", (identities) => ({
  concept: new CommentingMemoryConcept(identityReader(identities)),
  close: () => {},
}));
