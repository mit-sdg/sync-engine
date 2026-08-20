import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { digestDesign } from "../skills/sync-engine/scripts/design.ts";
import { buildPrompt, PromptBuildError } from "../skills/sync-engine/scripts/prompt.ts";

const temporary: string[] = [];

async function fixture(
  template: string,
): Promise<{ root: string; file(name: string, body: string): Promise<string> }> {
  const root = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-prompt-"));
  temporary.push(root);
  await mkdir(resolve(root, "roles"), { recursive: true });
  await writeFile(resolve(root, "roles/designer.md"), template);
  return {
    root,
    async file(name: string, body: string) {
      const path = resolve(root, "inputs", name);
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, body);
      return path;
    },
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("deterministic prompt construction", () => {
  test("expands one include and preserves shell-sensitive input bytes", async () => {
    const setup = await fixture(
      "# Role\r\n\r\n<!-- include: ../common.md -->\r\n\r\n<!-- input: brief -->\r\n",
    );
    await writeFile(resolve(setup.root, "common.md"), "Stable `core` and $VALUE.\r\n");
    const input = await setup.file(
      "brief.md",
      "Quotes: \"double\" and 'single'; Unicode: λ 🦔.\r\n\r\n",
    );

    const first = await buildPrompt({
      role: "designer",
      inputs: [{ slot: "brief", path: input }],
      promptRoot: setup.root,
    });
    const second = await buildPrompt({
      role: "designer",
      inputs: [{ slot: "brief", path: input }],
      promptRoot: setup.root,
    });

    expect(first.content).toBe(
      "# Role\n\nStable `core` and $VALUE.\n\n<!-- source: brief.md -->\n\nQuotes: \"double\" and 'single'; Unicode: λ 🦔.\n",
    );
    expect(second.content).toBe(first.content);
    expect(second.sha256).toBe(first.sha256);
    expect(first.content).not.toContain("\r");
  });

  test("selects phase-specific designer and critic templates", async () => {
    const setup = await fixture("# Map designer\n<!-- input: brief -->\n");
    await writeFile(
      resolve(setup.root, "roles/designer-contract.md"),
      "# Contract designer\n<!-- input: brief -->\n",
    );
    await writeFile(resolve(setup.root, "roles/critic.md"), "# Contract critic\n");
    await writeFile(resolve(setup.root, "roles/critic-map.md"), "# Map critic\n");
    const brief = await setup.file("brief.md", "# Brief");

    const map = await buildPrompt({
      role: "designer",
      mode: "map",
      inputs: [{ slot: "brief", path: brief }],
      promptRoot: setup.root,
    });
    const contract = await buildPrompt({
      role: "designer",
      mode: "contract",
      inputs: [{ slot: "brief", path: brief }],
      promptRoot: setup.root,
    });
    const mapCritic = await buildPrompt({
      role: "critic",
      mode: "map",
      inputs: [],
      promptRoot: setup.root,
    });

    expect(map.mode).toBe("map");
    expect(map.toolPolicy).toBe("decomposition-write-only");
    expect(map.content).toContain("# Map designer");
    expect(contract.mode).toBe("contract");
    expect(contract.toolPolicy).toBe("design-and-syntax-only");
    expect(contract.content).toContain("# Contract designer");
    expect(mapCritic.mode).toBe("map");
    expect(mapCritic.toolPolicy).toBe("no-tools");
    expect(mapCritic.content).toBe("# Map critic\n");
  });

  test("orders repeated input files by display name", async () => {
    const setup = await fixture("# Role\n\n<!-- input: brief -->\n");
    const z = await setup.file("z.md", "Z");
    const a = await setup.file("a.md", "A");
    const result = await buildPrompt({
      role: "designer",
      inputs: [
        { slot: "brief", path: z },
        { slot: "brief", path: a },
      ],
      promptRoot: setup.root,
    });
    expect(result.content.indexOf("source: a.md")).toBeLessThan(
      result.content.indexOf("source: z.md"),
    );
  });

  test("keeps the brief separate from a multi-file critic candidate", async () => {
    const setup = await fixture("# Designer\n<!-- input: brief -->\n");
    await writeFile(
      resolve(setup.root, "roles/critic.md"),
      "# Critic\n<!-- input: brief -->\n<!-- input: candidate -->\n",
    );
    const brief = await setup.file("brief.md", "# Brief");
    const concept = await setup.file("tasks.md", "# Tasks");
    const composition = await setup.file("application.md", "# Application");
    const types = await setup.file("types.md", "```types\n```");
    const result = await buildPrompt({
      role: "critic",
      inputs: [
        { slot: "brief", path: brief },
        { slot: "candidate", path: concept },
        { slot: "candidate", path: composition },
        { slot: "candidate", path: types },
      ],
      promptRoot: setup.root,
    });
    expect(result.sources.filter(({ kind }) => kind === "input")).toHaveLength(4);
    expect(result.content.match(/source: brief\.md/g)).toHaveLength(1);
    for (const file of ["tasks.md", "application.md", "types.md"]) {
      expect(result.content).toContain(`source: ${file}`);
    }
  });

  test("omits an empty optional input without interpreting input directives", async () => {
    const setup = await fixture("# Role\n\n<!-- input?: brief -->\n");
    const empty = await buildPrompt({ role: "designer", inputs: [], promptRoot: setup.root });
    expect(empty.content).toBe("# Role\n");

    const input = await setup.file("literal.md", "<!-- input: not-a-template -->\n");
    const literal = await buildPrompt({
      role: "designer",
      inputs: [{ slot: "brief", path: input }],
      promptRoot: setup.root,
    });
    expect(literal.content).toContain("<!-- input: not-a-template -->");
  });

  test.each([
    ["unknown role", { role: "other", inputs: [] }, "Unknown role"],
    ["missing required input", { role: "designer", inputs: [] }, "Missing required input"],
  ])("rejects %s", async (_name, partial, message) => {
    const setup = await fixture("# Role\n\n<!-- input: brief -->\n");
    await expect(buildPrompt({ ...partial, promptRoot: setup.root })).rejects.toThrow(message);
  });

  test("rejects unknown slots, duplicate files, and duplicate display names", async () => {
    const setup = await fixture("# Role\n\n<!-- input: brief -->\n<!-- input?: catalog -->\n");
    const input = await setup.file("same.md", "A");
    await expect(
      buildPrompt({
        role: "designer",
        inputs: [{ slot: "other", path: input }],
        promptRoot: setup.root,
      }),
    ).rejects.toThrow("has no input slot");
    await expect(
      buildPrompt({
        role: "designer",
        inputs: [
          { slot: "brief", path: input },
          { slot: "catalog", path: input },
        ],
        promptRoot: setup.root,
      }),
    ).rejects.toThrow("Duplicate input file");

    const elsewhere = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-display-"));
    temporary.push(elsewhere);
    const duplicateName = resolve(elsewhere, "same.md");
    await writeFile(duplicateName, "B");
    await expect(
      buildPrompt({
        role: "designer",
        inputs: [
          { slot: "brief", path: input },
          { slot: "catalog", path: duplicateName },
        ],
        promptRoot: setup.root,
      }),
    ).rejects.toThrow("Duplicate input display name");
  });

  test("rejects malformed, nested, and escaping includes", async () => {
    const malformed = await fixture("# Role\n<!-- input brief -->\n");
    await expect(
      buildPrompt({ role: "designer", inputs: [], promptRoot: malformed.root }),
    ).rejects.toThrow("Malformed directive");

    const nested = await fixture(
      "# Role\n<!-- include: ../common.md -->\n<!-- input?: brief -->\n",
    );
    await writeFile(resolve(nested.root, "common.md"), "<!-- input: hidden -->\n");
    await expect(
      buildPrompt({ role: "designer", inputs: [], promptRoot: nested.root }),
    ).rejects.toThrow("Included file contains a directive");

    const escape = await fixture("# Role\n<!-- include: ../../../outside.md -->\n");
    await expect(
      buildPrompt({ role: "designer", inputs: [], promptRoot: escape.root }),
    ).rejects.toThrow("Include escapes prompt root");
  });

  test("fails with source contributions over budget and records an explicit override", async () => {
    const setup = await fixture("# Role\n<!-- input: brief -->\n");
    const input = await setup.file("brief.md", "x".repeat(100));
    await expect(
      buildPrompt({
        role: "designer",
        inputs: [{ slot: "brief", path: input }],
        promptRoot: setup.root,
        maxBytes: 50,
      }),
    ).rejects.toThrow(/exceeding the 50-byte budget.*brief\.md: 101 bytes/);

    const result = await buildPrompt({
      role: "designer",
      inputs: [{ slot: "brief", path: input }],
      promptRoot: setup.root,
      maxBytes: 1000,
    });
    expect(result.budgetOverridden).toBe(true);
    expect(result.budget).toBe(1000);
  });

  test("never leaks an absolute input path into prompt bytes", async () => {
    const setup = await fixture("# Role\n<!-- input: brief -->\n");
    const input = await setup.file("brief.md", "Content");
    const result = await buildPrompt({
      role: "designer",
      inputs: [{ slot: "brief", path: input }],
      promptRoot: setup.root,
    });
    expect(result.content).toContain("source: brief.md");
    expect(result.content).not.toContain(setup.root);
    expect(result.sources.at(-1)?.path).toBe(input);
  });

  test("binds downstream prompts to the reviewed design digest", async () => {
    const setup = await fixture("# Designer\n<!-- input: brief -->\n");
    const downstreamRoles = [
      "concept-worker",
      "application-worker",
      "frontend-worker",
      "evidence-worker",
    ];
    for (const role of downstreamRoles) {
      await writeFile(
        resolve(setup.root, `roles/${role}.md`),
        `# ${role}\n<!-- input: assignment -->\n`,
      );
    }
    const assignment = await setup.file("assignment.md", "Implement the approved design.");
    const design = resolve(setup.root, "design");
    await mkdir(design);
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const reviewed = await digestDesign(design);
    // A concept worker is gated on its specifications alone, so it takes that digest.
    const conceptsDigest = (await digestDesign(design, "concepts")).digest;

    await expect(
      buildPrompt({
        role: "application-worker",
        inputs: [{ slot: "assignment", path: assignment }],
        promptRoot: setup.root,
      }),
    ).rejects.toThrow("requires designRoot and expectedDesignDigest");

    for (const role of downstreamRoles) {
      const built = await buildPrompt({
        role,
        inputs: [{ slot: "assignment", path: assignment }],
        promptRoot: setup.root,
        designRoot: design,
        expectedDesignDigest: role === "concept-worker" ? conceptsDigest : reviewed.digest,
      });
      expect(built.content).toContain("Implement the approved design.");
    }

    await writeFile(resolve(design, "types.md"), "# Changed types\n");
    // A concept worker survives a change outside concepts/, which is the point of the scope.
    await expect(
      buildPrompt({
        role: "concept-worker",
        inputs: [{ slot: "assignment", path: assignment }],
        promptRoot: setup.root,
        designRoot: design,
        expectedDesignDigest: conceptsDigest,
      }),
    ).resolves.toBeDefined();
    await expect(
      buildPrompt({
        role: "application-worker",
        inputs: [{ slot: "assignment", path: assignment }],
        promptRoot: setup.root,
        designRoot: design,
        expectedDesignDigest: reviewed.digest,
      }),
    ).rejects.toThrow("Design digest changed");
  });

  test("reads generated output as UTF-8", async () => {
    const setup = await fixture("# Role\n<!-- input: brief -->\n");
    const input = await setup.file("brief.md", "text");
    const result = await buildPrompt({
      role: "designer",
      inputs: [{ slot: "brief", path: input }],
      promptRoot: setup.root,
    });
    await writeFile(resolve(setup.root, "output.md"), result.content);
    expect(await readFile(resolve(setup.root, "output.md"), "utf8")).toBe(result.content);
    expect(result).not.toBeInstanceOf(PromptBuildError);
  });
});
