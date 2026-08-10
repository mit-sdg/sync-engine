import { describe } from "vite-plus/test";
import { defineAlertingConformance } from "./alerting.conformance.ts";
import { AlertingMemoryConcept } from "./alerting.memory.ts";

function identities(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("Identity fixture exhausted.");
    return identity;
  };
}

describe("Alerting memory", () => {
  defineAlertingConformance((values) => ({
    concept: new AlertingMemoryConcept(identities(values)),
    close: () => {},
  }));
});
