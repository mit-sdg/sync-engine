import { expect, test } from "vite-plus/test";
import { holdingConformance } from "./holding.conformance.ts";
import { HoldingConcept, type StopReason } from "./holding.ts";
import { holding } from "./registry.ts";

holdingConformance("node", () => {
  let ask: ((reason: StopReason) => void) | undefined;
  let active = 0;
  const concept = new HoldingConcept((ended) => {
    ask = ended;
    active += 1;
    return () => {
      active -= 1;
    };
  });
  return {
    concept,
    request: (reason: StopReason) => {
      if (ask === undefined) throw new Error("hold is not listening");
      ask(reason);
    },
    listening: () => active,
  };
});

test("Holding registry declares active and released hold observations", () => {
  expect(holding.specification.queries.map(({ name, promise }) => [name, promise])).toEqual([
    ["_hold", "optional"],
    ["_holding", "one"],
  ]);
});
