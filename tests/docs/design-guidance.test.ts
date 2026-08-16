import { readdir, readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

const designUrl = new URL("../../docs/user/design.md", import.meta.url);
const reviewUrl = new URL("../../docs/user/guide/reviewing-a-design.md", import.meta.url);
const conceptReferenceUrl = new URL(
  "../../docs/user/reference/concept-specification.md",
  import.meta.url,
);

async function source(url: URL): Promise<string> {
  return readFile(url, "utf8");
}

describe("generic design guidance", () => {
  test("recommends the complete Markdown layout without turning it into a checker restriction", async () => {
    const design = await source(designUrl);
    const review = await source(reviewUrl);
    for (const document of [design, review]) {
      expect(document).toContain("design/concepts/*.md");
      expect(document).toContain("design/compositions/*.md");
      expect(document).toContain("design/types.md");
      expect(document).toMatch(/not a checker\s+restriction/);
    }
    expect(design).toContain("pairs with one `src/compositions/*.ts` module");
    expect(review).toContain(
      "one composition\ndocument corresponds to one `src/compositions/*.ts` module",
    );
    expect(review).toContain("next to the decision it realizes");
  });

  test("states the capability, ownership, independence, reaction, and restraint rules", async () => {
    const design = await source(designUrl);
    const review = await source(reviewUrl);
    for (const phrase of [
      "Concept boundaries follow behavior, not implementation layout",
      "External identities are opaque",
      "Assign each durable domain fact one semantic owner",
      "Cross-concept policy",
      "Reaction pressure",
      "requested capability does not\nneed",
    ]) {
      expect(design).toContain(phrase);
    }
    for (const phrase of [
      "entity, table, class, package",
      "A concept never calls or imports a peer concept",
      "For every durable fact, name one semantic owner",
      "unnecessary behavior or complexity",
      "Apply reaction pressure",
    ]) {
      expect(review).toContain(phrase);
    }
  });

  test("treats Principle as concise archetypal explanation rather than exhaustive specification", async () => {
    const design = await source(designUrl);
    const review = await source(reviewUrl);
    expect(design).toContain("one or more concise archetypal prose scenarios");
    expect(design).toContain("it is not the complete specification");
    expect(design).toContain("variants, errors, or refusals only when they are essential");
    expect(design).toContain("may mention clearly external context");
    expect(review).toContain("one or more concise\n  archetypal scenarios");
    expect(review).not.toContain("Principle is one concrete scenario");
  });

  test("uses Syncpress and Commons as the requested boundary lessons", async () => {
    const design = await source(designUrl);
    for (const term of [
      "Syncpress is the primary command-line example",
      "Commanding",
      "Filing",
      "Holding",
      "cli.ts",
      "Commons and the catalog",
      "Labeling",
      "Trashing",
    ]) {
      expect(design).toContain(term);
    }
    expect(design).toContain("knows no Syncpress command");
    expect(design).toContain("thin call into the assembled application");
  });

  test("treats host concepts as strong guidance with explicit inert-adapter exceptions", async () => {
    const design = await source(designUrl);
    const review = await source(reviewUrl);
    for (const term of ["command-line", "filesystems", "clocks", "process signals", "network"]) {
      expect(design).toContain(term);
    }
    expect(design).toContain("strong guidance, not a universal validity rule");
    expect(design).toContain("direct adapter is reasonable\nwhen it is inert");
    expect(review).toContain("A direct inert adapter is permitted");
  });

  test("documents the core-owned draft parser without evidence or application inspection", async () => {
    const reference = await source(conceptReferenceUrl);
    expect(reference).toContain("sync-engine check-design design/concepts/*.md");
    expect(reference).toContain("loads no application configuration or TypeScript source");
    expect(reference).toContain("writes nothing");
    expect(reference).toContain("reports only authored-design form failures");
  });

  test("keeps generic guidance free of application-agent orchestration", async () => {
    const generic = [
      await source(designUrl),
      await source(reviewUrl),
      await source(conceptReferenceUrl),
    ].join("\n");
    for (const orchestration of [
      "subagent",
      "designer worker",
      "critic worker",
      "repair pass",
      "coordinator context",
      "mutation boundary",
    ]) {
      expect(generic.toLowerCase()).not.toContain(orchestration);
    }
  });

  test("keeps every shipped composition design paired with its example source module", async () => {
    const examples = new URL("../../examples/", import.meta.url);
    for (const application of ["reading-circle", "operations-room", "message-board"]) {
      const designDirectory = new URL(`${application}/design/compositions/`, examples);
      const sourceDirectory = new URL(`${application}/src/compositions/`, examples);
      const documents = (await readdir(designDirectory))
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.slice(0, -3))
        .sort();
      const modules = new Set(
        (await readdir(sourceDirectory))
          .filter((name) => name.endsWith(".ts"))
          .map((name) => name.slice(0, -3)),
      );
      for (const document of documents) {
        expect(modules, `${application}/${document}`).toContain(document);
      }
    }
  });
});
