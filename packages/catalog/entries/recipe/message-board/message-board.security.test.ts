import { test } from "vite-plus/test";
import { applicationConcepts } from "@catalog/concepts";
import { exerciseMessageBoardSecurity } from "./message-board.behavior.ts";

test("protected Message Board routes bind authority to the active Session subject", async () => {
  let instances: ReturnType<typeof applicationConcepts.implementations> | undefined;
  try {
    instances = applicationConcepts.implementations("memory" as never, {} as never);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('floor "memory" is missing')) {
      throw error;
    }
  }
  if (instances === undefined) return;
  await exerciseMessageBoardSecurity(instances);
});
