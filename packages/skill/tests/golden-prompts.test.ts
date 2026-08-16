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
    expect(built.sha256).toBe("5b65208d4a1367327a1bef08516f8e1c6a8fc95e795f9c766bbd9ab02a45af27");
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
    expect(built.sha256).toBe("0badb1e8b1f8dc4c80f338d7ce59b0421fdf95c0aa7096ac65d056c4deed8924");
  });
});
