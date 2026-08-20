import { test } from "vite-plus/test";
import { expectExpiringConformance } from "./expiring.conformance.ts";
import { ExpiringMemoryConcept } from "./expiring.memory.ts";

test("Expiring memory principle and refusals", async () => {
  await expectExpiringConformance(new ExpiringMemoryConcept());
});
