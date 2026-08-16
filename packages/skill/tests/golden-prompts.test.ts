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
    expect(built.sha256).toBe("e1725610c3bd4679f086c7d0e498fef448194d599b87c4d558abd8482502e711");
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
    expect(built.sha256).toBe("5b7068a5b225817daa2c2b4245743b953919d0ba9ca0cdbae6926788cf49cde8");
  });
});
