import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { catalogCommand, specificationCatalog } from "@command/catalog";
import { canonicalJson } from "@engine/utils/canonical-json";

let directory = "";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const main = join(root, "src/command/main.ts");

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sync-engine-catalog-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("sync-engine catalog", () => {
  test("parses, deduplicates, and sorts specification-only concept roots", async () => {
    await writeSpec("concepts/zulu/spec.md", "Zulu");
    await writeSpec("concepts/alpha/spec.md", "Alpha");

    const catalog = await specificationCatalog(["concepts", "concepts/alpha"], directory);

    expect(Object.keys(catalog)).toEqual(["concepts/alpha/spec.md", "concepts/zulu/spec.md"]);
    expect(catalog["concepts/alpha/spec.md"]?.purpose).toBe("Keep Alpha records.");
    expect(catalog["concepts/zulu/spec.md"]?.format).toBe("sync-engine.concept-specification");
  });

  test("source command emits canonical JSON without classes or project metadata", async () => {
    await writeSpec("design/concepts/noting/spec.md", "Noting");

    const result = run("catalog", "--concepts", "design/concepts");
    const parsed = JSON.parse(result.stdout) as Record<string, { version: number }>;

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.endsWith("\n")).toBe(true);
    expect(result.stdout).toBe(canonicalJson(parsed));
    expect(Object.keys(parsed)).toEqual(["design/concepts/noting/spec.md"]);
    expect(parsed["design/concepts/noting/spec.md"]?.version).toBe(1);
  });

  test("equivalent line endings produce identical canonical bytes", async () => {
    const target = join(directory, "concepts/noting/spec.md");
    await mkdir(dirname(target), { recursive: true });
    const markdown = specification("Noting");
    await writeFile(target, markdown);
    const lf = run("catalog", "--concepts", "concepts");
    await writeFile(target, markdown.replace(/\n/g, "\r\n"));
    const crlf = run("catalog", "--concepts", "concepts");
    await writeFile(target, markdown.replace(/\n/g, "\r"));
    const cr = run("catalog", "--concepts", "concepts");

    expect(lf.status).toBe(0);
    expect(crlf.stdout).toBe(lf.stdout);
    expect(cr.stdout).toBe(lf.stdout);
  });

  test("catalog dispatch does not load the TypeScript compiler", async () => {
    await writeSpec("concepts/noting/spec.md", "Noting");
    const preload = join(directory, "reject-typescript.ts");
    await writeFile(
      preload,
      `import { mock } from "bun:test";
mock.module("typescript", () => {
  throw new Error("catalog imported TypeScript");
});
`,
    );

    const result = spawnSync(
      "bun",
      ["--preload", preload, main, "catalog", "--concepts", "concepts"],
      { cwd: directory, encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toHaveProperty("concepts/noting/spec.md");
  });

  test("command defaults to src/concepts and writes one complete document", async () => {
    await writeSpec("src/concepts/noting/spec.md", "Noting");
    vi.spyOn(process, "cwd").mockReturnValue(directory);
    let output = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    await catalogCommand([]);

    expect(Object.keys(JSON.parse(output) as object)).toEqual(["src/concepts/noting/spec.md"]);
    expect(output.endsWith("\n")).toBe(true);
  });

  test("malformed input fails without partial standard output", async () => {
    await writeSpec("concepts/alpha/spec.md", "Alpha");
    const malformed = join(directory, "concepts/broken/spec.md");
    await mkdir(dirname(malformed), { recursive: true });
    await writeFile(malformed, "# Broken\n");

    const result = run("catalog", "--concepts", "concepts");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Failed to parse concepts/broken/spec.md");
    expect(result.stderr).not.toContain("at catalogCommand");
    await expect(specificationCatalog(["concepts"], directory)).rejects.toThrow(
      "Failed to parse concepts/broken/spec.md",
    );
  });

  test("empty roots and invalid arguments fail without output", async () => {
    await mkdir(join(directory, "concepts"));
    const empty = run("catalog", "--concepts", "concepts");
    const repeated = run("catalog", "--concepts", "concepts", "--concepts", "other-concepts");

    expect(empty.status).toBe(1);
    expect(empty.stdout).toBe("");
    expect(empty.stderr).toContain("No concept specifications found under: concepts");
    expect(repeated.status).toBe(1);
    expect(repeated.stdout).toBe("");
    expect(repeated.stderr).toContain("sync-engine catalog [--concepts <path...>]");
    await expect(specificationCatalog(["missing"], directory)).rejects.toThrow(
      "Concept root not found: missing",
    );
    await expect(catalogCommand(["--concepts"])).rejects.toThrow(
      "sync-engine catalog [--concepts <path...>]",
    );
    await expect(catalogCommand(["trailing"])).rejects.toThrow(
      "sync-engine catalog [--concepts <path...>]",
    );
    await expect(catalogCommand(["--concepts", ""])).rejects.toThrow(
      "sync-engine catalog [--concepts <path...>]",
    );
  });

  test("missing and outside roots fail instead of producing an incomplete catalog", async () => {
    await writeSpec("concepts/noting/spec.md", "Noting");
    const missing = run("catalog", "--concepts", "concepts", "missing");
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("Concept root not found: missing");

    const outside = await mkdtemp(join(tmpdir(), "sync-engine-catalog-outside-"));
    try {
      const target = join(outside, "spec.md");
      await writeFile(target, specification("Outside"));
      const result = run("catalog", "--concepts", outside);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("Concept root is outside the current project");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("canonical roots deduplicate internal aliases and reject alias escapes", async () => {
    await writeSpec("concepts/noting/spec.md", "Noting");
    const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
    await symlink(join(directory, "concepts"), join(directory, "concept-alias"), directoryLinkType);

    const catalog = await specificationCatalog(["concepts", "concept-alias"], directory);
    expect(Object.keys(catalog)).toEqual(["concepts/noting/spec.md"]);

    const outside = await mkdtemp(join(tmpdir(), "sync-engine-catalog-link-outside-"));
    try {
      await writeFile(join(outside, "spec.md"), specification("Outside"));
      await symlink(outside, join(directory, "outside-alias"), directoryLinkType);
      await expect(specificationCatalog(["outside-alias"], directory)).rejects.toThrow(
        "Concept root is outside the current project",
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("nested symlinks fail instead of producing an incomplete catalog", async () => {
    await writeSpec("concepts/alpha/spec.md", "Alpha");
    await writeSpec("linked/noting/spec.md", "Noting");
    await symlink(
      join(directory, "linked"),
      join(directory, "concepts/linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const result = run("catalog", "--concepts", "concepts");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Symbolic links are not allowed inside concept roots");
    await expect(specificationCatalog(["concepts"], directory)).rejects.toThrow(
      "Symbolic links are not allowed inside concept roots",
    );
  });

  test("rejects path segments that are separators on another platform", async () => {
    if (sep !== "/") return;
    await writeSpec("concepts/back\\slash/spec.md", "Backslash");

    const result = run("catalog", "--concepts", "concepts");

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Concept specification path is not portable");
  });
});

async function writeSpec(path: string, name: string): Promise<void> {
  const target = join(directory, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, specification(name));
}

function specification(name: string): string {
  return `# ${name}

## Purpose

Keep ${name} records.

## Principle

Writing one record makes it available for later use.

## State

A set of records.

## Actions

\`\`\`actions
write (text: String) : return (record: Record)
  add a record with text
  return record
\`\`\`

## Queries

\`\`\`queries
\`\`\`
`;
}

function run(...args: string[]) {
  return spawnSync("bun", [main, ...args], { cwd: directory, encoding: "utf8" });
}
