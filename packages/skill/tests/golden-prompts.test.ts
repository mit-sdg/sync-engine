import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import { buildPrompt } from "../skills/sync-engine/scripts/prompt.ts";

const promptRoot = "packages/skill/skills/sync-engine/prompts";

async function file(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("representative prompt bytes", () => {
  test("matches the task-manager designer golden prompt", async () => {
    const built = await buildPrompt({
      role: "designer",
      promptRoot,
      inputs: [{ slot: "brief", path: "packages/skill/tests/fixtures/task-manager/brief.md" }],
    });
    expect(built.content).toBe(
      await file("packages/skill/tests/fixtures/task-manager/designer.prompt.txt"),
    );
    expect(built.sha256).toBe("e2e0497f28f35ee0bd209c36f9f04a16babf2c3b8de107729b9cedb525eb391e");
  });

  test("matches the message-board critic golden prompt", async () => {
    const built = await buildPrompt({
      role: "critic",
      promptRoot,
      inputs: [
        { slot: "brief", path: "packages/skill/tests/fixtures/message-board/brief.md" },
        {
          slot: "candidate",
          path: "packages/skill/tests/fixtures/message-board/candidate.md",
        },
      ],
    });
    expect(built.content).toBe(
      await file("packages/skill/tests/fixtures/message-board/critic.prompt.txt"),
    );
    expect(built.sha256).toBe("14ff8e49cac3c3d56b09f786eed0f0fc55d26fc385cd9b9d1e992a8f0e279a9a");
  });
});
