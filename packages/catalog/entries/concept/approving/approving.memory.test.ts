import { test } from "vite-plus/test";
import { exerciseApprovingBehavior, identities } from "./approving.behavior.ts";
import { ApprovingMemoryConcept } from "./approving.memory.ts";

test("Approving memory principle and refusals", async () => {
  const approving = new ApprovingMemoryConcept(
    identities(
      "review-9",
      "review-8",
      "review-7",
      "review-6",
      "review-5",
      "review-4",
      "review-3",
      "review-2",
      "review-1",
    ),
  );
  await exerciseApprovingBehavior(approving);
});
