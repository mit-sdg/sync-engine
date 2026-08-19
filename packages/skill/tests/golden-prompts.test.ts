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
    expect(built.sha256).toBe("9fa92b21e95280284d6dfded077c394a2baaf48397a41d042b55d232aa3175d5");
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
    expect(built.sha256).toBe("693f48c23dcb836470e193274d3fe4f41f03b5f6f65d0a223a8888fb58198cbe");
  });
});
