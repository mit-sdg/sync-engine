import { test } from "vite-plus/test";
import { expectTallyingConformance } from "./tallying.conformance.ts";
import { TallyingMemoryConcept } from "./tallying.memory.ts";

test("Tallying memory principle and refusals", async () => {
  await expectTallyingConformance(new TallyingMemoryConcept());
});
