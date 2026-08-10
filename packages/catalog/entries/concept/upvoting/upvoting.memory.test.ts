import { test } from "vite-plus/test";
import { expectUpvotingConformance } from "./upvoting.conformance.ts";
import { UpvotingMemoryConcept } from "./upvoting.memory.ts";

test("Upvoting memory principle and refusals", async () => {
  await expectUpvotingConformance(new UpvotingMemoryConcept());
});
