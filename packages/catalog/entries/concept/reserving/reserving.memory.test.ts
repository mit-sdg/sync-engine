import { describe } from "vite-plus/test";
import { defineReservingConformance } from "./reserving.conformance.ts";
import { ReservingMemoryConcept } from "./reserving.memory.ts";

function identities(values: readonly string[]): () => string {
  const remaining = [...values];
  return () => {
    const identity = remaining.shift();
    if (identity === undefined) throw new Error("Identity fixture exhausted.");
    return identity;
  };
}

describe("Reserving memory", () => {
  defineReservingConformance((values) => ({
    concept: new ReservingMemoryConcept(identities(values)),
    close: () => {},
  }));
});
