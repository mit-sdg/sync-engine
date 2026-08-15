import { readdir, readFile, stat } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

const root = new URL("../", import.meta.url);
const skillRoot = new URL("skills/sync-engine/", root);
const entry = new URL("SKILL.md", skillRoot);
const references = {
  workflow: new URL("references/workflow.md", skillRoot),
  design: new URL("references/design-roles.md", skillRoot),
  implementation: new URL("references/implementation-roles.md", skillRoot),
};

async function text(url: URL): Promise<string> {
  return readFile(url, "utf8");
}

async function filesBelow(directory: URL, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (item.name === "node_modules") continue;
    const path = `${prefix}${item.name}`;
    if (item.isDirectory())
      found.push(...(await filesBelow(new URL(`${item.name}/`, directory), `${path}/`)));
    else found.push(path);
  }
  return found.sort();
}

describe("sync-engine Agent Skill", () => {
  test("requires native independent roles and pauses when they are unavailable", async () => {
    const source = await text(entry);
    expect(source).toMatch(/^---\nname: sync-engine\ndescription:/);
    expect(source).toContain("applications using concept design and @mit-sdg/sync-engine");
    expect(source).toContain("Native subagents are required");
    expect(source).toContain("pause and tell the user");
    expect(source).toContain("do not imitate independence with sequential\n  self-review");
    expect(source).toContain("routine/normal reasoning");
    for (const role of [
      "design",
      "criticism",
      "concept implementation",
      "integration",
      "evidence",
    ]) {
      expect(source).toContain(role);
    }
  });

  test("offers assumption mode or an unbounded interactive design discussion", async () => {
    const entrySource = await text(entry);
    const workflow = await text(references.workflow);
    expect(entrySource).toContain("discuss the design first (recommended)");
    expect(entrySource).toContain("proceed with general assumptions");
    expect(entrySource).toContain("one or\n   two material product questions per turn");
    expect(workflow).toContain("Before setup, baseline work, or design");
    expect(workflow).toContain("exactly one or two questions");
    expect(workflow).toContain("concrete answer options");
    expect(workflow).toContain("identify one recommended answer");
    expect(workflow).toContain("continue discussing the design or move to a draft");
    expect(workflow).toContain("do not impose a cumulative cap");
    expect(workflow).toContain("Do not ask product-discovery questions");
    expect(workflow).toContain("candidate Markdown makes them\n   reviewable");
  });

  test("closes and bounds designer context and output", async () => {
    const source = await text(references.design);
    expect(source).toContain("exact complete text directly in each applicable role prompt");
    expect(source).toMatch(/no more than five concept\s+designs and two recipes/);
    expect(source).toMatch(/Do not supply catalog\s+implementation source during design/);
    for (const freedom of ["copy", "simplify", "split", "combine", "rename"]) {
      expect(source).toContain(freedom);
    }
    expect(source).toContain("Exactly the application's `design/` directory");
    expect(source).toContain("Markdown under that directory only");
    expect(source).toContain("Complete `concepts/*.md`, `compositions/*.md`, and `types.md`");
    expect(source).toContain("at most two unresolved product questions");
    for (const forbidden of [
      "application TypeScript",
      "generated files",
      "Git",
      "package configuration",
      "tests",
      "framework implementation",
      "framework API documentation",
    ]) {
      expect(source).toContain(forbidden);
    }
    expect(source).toContain("must not write `application.md`");
  });

  test("uses the core parser and a fresh read-only critic before one user approval", async () => {
    const source = await text(references.design);
    expect(source).toContain("bunx sync-engine check-concepts design/concepts/*.md");
    expect(source).toContain("Send each diagnostic back to the original\ndesigner subagent");
    expect(source).toContain("create a fresh native critic subagent");
    expect(source).toContain("is read-only");
    expect(source).toContain("does not edit files or create a persistent report");
    expect(source).toContain("at most two\ncritic-driven repair turns");
    expect(source).toContain("links the actual Markdown");
    expect(source).toContain("approve, revise, or discuss");
    expect(source).toContain("recommend one next action");
    expect(source).toContain("without a cumulative cap");
    expect(source).toContain("user-directed discussion or revision rounds");
    expect(source).toContain("rerun syntax and fresh criticism");
  });

  test("gives implementation roles narrow disjoint contexts", async () => {
    const source = await text(references.implementation);
    expect(source).toContain("run all independent concept workers\nconcurrently");
    expect(source).toContain("that concept's approved specification");
    expect(source).toContain("at most one selected catalog or local implementation example");
    expect(source).toContain("exact `src/concepts/<name>/` directory and focused test paths");
    expect(source).toContain("one worker for each\napproved `design/compositions/<name>.md`");
    expect(source).toContain("only the concept specifications referenced by that document");
    expect(source).toContain("No earlier worker\nmay opportunistically perform this role");
    expect(source).toContain("only newly assigned\nobjective-driven scenario and test paths");
    expect(source).toContain("must not edit\nproduction source");
  });

  test("requires renewed review for material design changes", async () => {
    const workflow = await text(references.workflow);
    const implementation = await text(references.implementation);
    expect(workflow).toContain("show the changed design to the user");
    expect(workflow).toContain("obtain\nrenewed approval");
    expect(implementation).toContain(
      "No worker may weaken, reinterpret, or silently edit approved Markdown",
    );
    expect(implementation).toMatch(/obtain renewed\s+approval before resuming affected workers/);
  });

  test("defines safe setup, bounded start baselines, and concise acceptance", async () => {
    const source = await text(references.workflow);
    expect(source).toContain("initialize or reuse a Bun package");
    expect(source).toContain("install that same exact version with Bun");
    expect(source).toContain("Run the installed `sync-engine setup`");
    expect(source).toContain("Run `bun run start` as a bounded smoke baseline");
    expect(source).toContain("documented readiness signal");
    expect(source).toContain("request graceful shutdown");
    expect(source).toContain("Do not rerun setup merely to impose default files or scripts");
    expect(source).toContain("Acceptance closes the conversation only");
  });

  test("ships only the documentation workflow and no obsolete support machinery", async () => {
    const manifest = JSON.parse(await text(new URL("package.json", root))) as {
      bin?: unknown;
      exports?: unknown;
      files?: string[];
      scripts?: unknown;
    };
    expect(manifest.bin).toBeUndefined();
    expect(manifest.scripts).toBeUndefined();
    expect(manifest.exports).toEqual({});
    expect(manifest.files).toEqual(["LICENSE", "NOTICE", "README.md", "skills"]);
    expect(await filesBelow(root)).toEqual([
      "LICENSE",
      "NOTICE",
      "README.md",
      "package.json",
      "skills/sync-engine/SKILL.md",
      "skills/sync-engine/references/design-roles.md",
      "skills/sync-engine/references/implementation-roles.md",
      "skills/sync-engine/references/workflow.md",
      "tests/documentation.test.ts",
    ]);

    const shipped = [
      await text(new URL("README.md", root)),
      await text(entry),
      await text(references.workflow),
      await text(references.design),
      await text(references.implementation),
    ].join("\n");
    for (const removed of [
      "sync-engine-skill snapshot",
      "sync-engine-skill object",
      "sync-engine-skill spec",
      "sync-engine-skill design-evidence",
      "project-snapshot",
      "spec-set",
      "designDigest",
      "worktreeDigest",
    ]) {
      expect(shipped).not.toContain(removed);
    }
  });

  test("installs matching context tools and limits analysis to eligible roles", async () => {
    const manifest = JSON.parse(await text(new URL("package.json", root))) as {
      version: string;
      dependencies: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({
      "@mit-sdg/sync-engine-analysis": manifest.version,
      "@mit-sdg/sync-engine-catalog": manifest.version,
    });
    const workflow = await text(references.workflow);
    const design = await text(references.design);
    const implementation = await text(references.implementation);
    expect(workflow).toContain("sync-engine-analysis summary");
    expect(workflow).toContain("Ordinary repository search and source reading is fallback only");
    expect(workflow).toContain("outside the manifest");
    expect(workflow).toContain("concrete compiler/runtime\nfailure");
    expect(design).toContain("must not contain analysis results");
    expect(design).toContain("must not\ninvoke `sync-engine-analysis`");
    expect(implementation).toContain("exact context normally makes\nanalysis unnecessary");
    expect(implementation).toContain("sync-engine-analysis search");
    expect(implementation).toContain("sync-engine-analysis\ndiagnostics");
    expect(implementation).not.toMatch(/concept worker[\s\S]{0,500}sync-engine-analysis search/);
  });

  test("keeps every packaged local Markdown link valid", async () => {
    for (const path of [
      "README.md",
      "skills/sync-engine/SKILL.md",
      "skills/sync-engine/references/workflow.md",
      "skills/sync-engine/references/design-roles.md",
      "skills/sync-engine/references/implementation-roles.md",
    ]) {
      const url = new URL(path, root);
      const markdown = await text(url);
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
        await expect(stat(new URL(match[1], url)), `${path}: ${match[1]}`).resolves.toBeDefined();
      }
    }
  });
});
