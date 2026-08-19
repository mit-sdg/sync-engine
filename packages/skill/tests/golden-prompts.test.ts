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
    expect(built.sha256).toBe("9446957dfd10e5c94d8a1e9fe556952dfbdcd49f297faa6c44d2b73b3ede9b3e");
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
    expect(built.sha256).toBe("43327307c672ce393c9b8c5ba3d60b5dff1af1af0b119afb995ae2fe1660d18f");
  });
});
