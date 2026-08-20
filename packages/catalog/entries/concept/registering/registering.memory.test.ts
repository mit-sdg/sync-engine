import { test } from "vite-plus/test";
import { expectRegisteringConformance } from "./registering.conformance.ts";
import { RegisteringMemoryConcept } from "./registering.memory.ts";

test("Registering memory principle and refusals", async () => {
  await expectRegisteringConformance(new RegisteringMemoryConcept());
});
