import { globSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { markdownSections, sectionRecord } from "./test-support.ts";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function typescriptFence(section: string): string {
  const match = /(?:^|\n)```ts\n([\s\S]*?)\n```(?:\n|$)/.exec(section);
  if (match === null) throw new Error("Section has no TypeScript fence");
  return match[1]!;
}

function excerpt(source: string, start: string, next: string): string {
  const from = source.indexOf(start);
  if (from < 0) throw new Error(`Missing excerpt start: ${start}`);
  const to = source.indexOf(next, from);
  if (to < 0) throw new Error(`Missing excerpt end after: ${start}`);
  return source.slice(from, to).trimEnd();
}

describe("prompt guidance", () => {
  test("keeps orchestration personas outside bounded prompt content", () => {
    const promptRoot = new URL("../skills/sync-engine/prompts/", import.meta.url);
    const files = [
      ...globSync("guidance/**/*.md", { cwd: promptRoot }),
      ...globSync("roles/*.md", { cwd: promptRoot }),
    ];
    const persona =
      /\b(?:coordinator|application worker|concept worker|frontend worker|evidence worker|contract designer|decomposition designer|contract critic|decomposition critic)\b/gi;
    const leaks = files.flatMap((file) => {
      const body = readFileSync(new URL(file, promptRoot), "utf8").replace(/^# .*\n/, "");
      return [...body.matchAll(persona)].map((match) => ({ file, persona: match[0] }));
    });
    expect(leaks).toEqual([]);
  });

  test("keeps application realization patterns byte-exact with tested examples", () => {
    const guide = read("../skills/sync-engine/prompts/guidance/api/application-example.md");
    const sections = sectionRecord(
      markdownSections(guide, 2, [
        "Endpoint-owned sequencing",
        "Guarded success and total fallback",
        "Intentionally separate reaction",
      ]),
    );
    const board = read("../../../examples/message-board/src/compositions/Board.ts");
    const circle = read("../../../examples/reading-circle/src/compositions/ReadingCircle.ts");

    expect(typescriptFence(sections["Endpoint-owned sequencing"]!)).toBe(
      excerpt(board, "const PublishPost = endpoint(", "\n\n/**\n * Commenting accepts"),
    );
    expect(typescriptFence(sections["Guarded success and total fallback"]!)).toBe(
      excerpt(board, "const AddComment = endpoint(", "\n\n/**\n * Commenting enforces"),
    );
    expect(typescriptFence(sections["Intentionally separate reaction"]!)).toBe(
      excerpt(circle, "const SelectedReadingOpensDiscussion = reaction(", "\n\nconst CirclePage"),
    );
  });
});
