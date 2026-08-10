import { auditingConformance } from "./auditing.conformance.ts";
import { AuditingMemoryConcept } from "./auditing.memory.ts";

function identityReader(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const value = remaining.shift();
    if (value === undefined) throw new Error("No deterministic identity remains.");
    return value;
  };
}

auditingConformance("memory", (identities) => ({
  concept: new AuditingMemoryConcept(identityReader(identities)),
  close: () => {},
}));
