import { globSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { CreateLink } from "./fixtures/application-examples.ts";
import { markdownSections, sectionRecord } from "./test-support.ts";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function typescriptFence(section: string): string {
  const match = /(?:^|\n)```ts\n([\s\S]*?)\n```(?:\n|$)/.exec(section);
  if (match === null) throw new Error("Section has no TypeScript fence");
  return match[1]!;
}

function endpointEntries(source: string): Array<{ identity: string; path: string }> {
  return [...source.matchAll(/(?:^|\n)```endpoints\n([\s\S]*?)\n```(?:\n|$)/g)].flatMap(
    ([, body]) =>
      body!.split("\n").map((line) => {
        const match = /^(\w+(?:\.\w+)+) at (\/\S*)$/.exec(line);
        if (match === null) throw new Error(`Invalid documented endpoint entry: ${line}`);
        return { identity: match[1]!, path: match[2]! };
      }),
  );
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

  test("keeps brief instructions out of rendered work content", () => {
    const brief = read("../skills/sync-engine/prompts/brief.md");
    expect(brief).toContain(
      "<!-- Record only product or process choices that later work must know.",
    );
    expect(brief).not.toMatch(/^Record only choices/m);
    expect(brief).not.toMatch(/^Keep a concise chronological record/m);
  });

  test("documents endpoint entries as additive identity and path contracts", () => {
    const authored = read("../skills/sync-engine/prompts/guidance/design/authored-format.md");
    const composition = read("../skills/sync-engine/prompts/guidance/api/composition.md");
    const http = read("../skills/sync-engine/prompts/guidance/api/http-host.md");

    expect(endpointEntries(authored)).toEqual([
      { identity: "Circle.Reading.AddResponse", path: "/circle/respond" },
    ]);
    expect(endpointEntries(composition)).toEqual([
      { identity: "Board.Publishing.PublishPost", path: "/board/post" },
    ]);
    expect(endpointEntries(http)).toEqual([
      { identity: "LinkShortener.Links.Resolve", path: "/links/resolve" },
    ]);
    for (const source of [authored, composition, http]) {
      for (const { identity } of endpointEntries(source)) {
        expect(
          source.match(new RegExp(`reaction:${identity.replaceAll(".", "\\.")}`, "g")),
        ).toHaveLength(1);
      }
    }
  });

  test("keeps normal role kits complete enough to design, review, and implement", () => {
    const decomposition = read("../skills/sync-engine/prompts/guidance/design/decomposition.md");
    const contracts = read("../skills/sync-engine/prompts/guidance/design/contracts.md");
    const decompositionCritic = read("../skills/sync-engine/prompts/roles/critic-decomposition.md");
    const contractCritic = read("../skills/sync-engine/prompts/roles/critic-contracts.md");
    const implementationCritic = read(
      "../skills/sync-engine/prompts/roles/critic-implementation.md",
    );
    const catalog = read("../skills/sync-engine/prompts/guidance/catalog.md");
    const concepts = read("../skills/sync-engine/prompts/guidance/implementation/concepts.md");
    const application = read(
      "../skills/sync-engine/prompts/guidance/implementation/application.md",
    );
    const frameworkSafety = read(
      "../skills/sync-engine/prompts/guidance/implementation/framework-safety.md",
    );

    for (const phrase of [
      "sole decision",
      "realistic reuse boundary",
      "strongest plausible split or merge concern",
      "retry identity when retries are promised",
    ]) {
      expect(decomposition).toContain(phrase);
    }
    for (const phrase of [
      "unchanged post-refusal state",
      "ordering of required effects relative to acknowledgement",
      "bypassable authorization",
      "exactly one matching `Declaration.Identity at /path` entry",
    ]) {
      expect(contracts).toContain(phrase);
    }
    expect(decompositionCritic).toContain("one verdict");
    expect(decompositionCritic).toContain("Overloaded");
    expect(decompositionCritic).toContain("Fragmented");
    expect(decompositionCritic).toContain("merely for atomicity");
    expect(decompositionCritic).toContain("retry-only ledger");
    expect(contractCritic).toContain("one compact assessment row per affected obligation");
    expect(contractCritic).toContain(
      "the absence of an application contract in supplied or granted design is a blocker",
    );
    expect(implementationCritic).toContain("acknowledgement order");
    expect(implementationCritic).toContain("test adequacy");
    expect(catalog).toContain("bunx --no-install sync-engine-catalog show concept/<name>");
    expect(concepts).toContain("`ConceptClass.length === 0`");
    expect(concepts).toContain("never the tuple union `[] | [Row]`");
    expect(application).toContain("import { conceptSet, registerConcept }");
    expect(application).toContain("import { InvalidContent, PostingConcept }");
    expect(application).toContain('import { assemble } from "@mit-sdg/sync-engine/assembly"');
    expect(application).toContain('import { composition } from "./composition.ts"');
    expect(application).toContain("applicationConceptSet.implementations()");
    expect(frameworkSafety).toContain("Do not browse package trees");
    expect(frameworkSafety).toContain("Never inspect package `dist`");
    expect(frameworkSafety).not.toContain("Do not reload a skill or workflow");
  });

  test("keeps application realization patterns byte-exact with tested examples", () => {
    const guide = read("../skills/sync-engine/prompts/guidance/api/application-example.md");
    const sections = sectionRecord(
      markdownSections(guide, 2, [
        "Endpoint-owned sequencing",
        "Guarded success and total fallback",
        "Computed optional-input branches",
        "Intentionally separate reaction",
      ]),
    );
    const board = read("../../../examples/message-board/src/compositions/Board.ts");
    const circle = read("../../../examples/reading-circle/src/compositions/ReadingCircle.ts");
    const skillExamples = read("./fixtures/application-examples.ts");

    expect(typescriptFence(sections["Endpoint-owned sequencing"]!)).toBe(
      excerpt(board, "const PublishPost = endpoint(", "\n\n/**\n * Commenting accepts"),
    );
    expect(typescriptFence(sections["Guarded success and total fallback"]!)).toBe(
      excerpt(board, "const AddComment = endpoint(", "\n\n/**\n * Commenting enforces"),
    );
    expect(typescriptFence(sections["Computed optional-input branches"]!)).toBe(
      excerpt(skillExamples, "export const CreateLink = endpoint(", "\n);\n") + "\n);",
    );
    expect(CreateLink).toBeDefined();
    expect(typescriptFence(sections["Intentionally separate reaction"]!)).toBe(
      excerpt(circle, "const SelectedReadingOpensDiscussion = reaction(", "\n\nconst CirclePage"),
    );
  });
});
