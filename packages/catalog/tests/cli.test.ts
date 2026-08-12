import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { runCatalog } from "../src/cli.ts";

async function treeDigest(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string): Promise<void> {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, item.name);
      if (item.isDirectory()) await visit(path);
      else if (item.isFile()) hash.update(path.slice(root.length)).update(await readFile(path));
    }
  }
  await visit(root);
  return hash.digest("hex");
}

function capture(): { output: string[]; restore: () => void } {
  const output: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((value = "") => output.push(`${String(value)}\n`));
  const write = vi.spyOn(process.stdout, "write").mockImplementation(((
    value: string | Uint8Array,
  ) => {
    output.push(String(value));
    return true;
  }) as typeof process.stdout.write);
  return {
    output,
    restore: () => {
      log.mockRestore();
      write.mockRestore();
    },
  };
}

describe("catalog CLI", () => {
  afterEach(() => vi.restoreAllMocks());

  test("lists entries as tab-separated records", async () => {
    const { output } = capture();
    await runCatalog(["list", "recipe"]);
    expect(output.join("")).toContain("recipe/workshop-selection\trecipe\t");
    expect(output.join("")).not.toContain("concept/selecting");
  });

  test("shows a labeled design and available source selectors", async () => {
    const { output } = capture();
    await runCatalog(["show", "concept/selecting"]);
    expect(output.join("")).toContain("  selecting.shared.ts\n");
    expect(output.join("")).toContain("  memory/selecting.memory.ts\n");
    expect(output.join("")).toContain("Asset: design\nFile: spec.md\n---\n# Selecting");
  });

  test("prints one explicitly selected source with labels", async () => {
    const { output } = capture();
    await runCatalog(["source", "concept/selecting", "memory/selecting.memory.ts"]);
    expect(output.join("")).toContain("Asset: source (memory/selecting.memory.ts)");
    expect(output.join("")).toContain("File: selecting.memory.ts");
  });

  test("raw mode emits only asset bytes", async () => {
    const expected = await readFile(
      new URL("../entries/recipe/workshop-selection/spec.md", import.meta.url),
      "utf8",
    );
    const { output } = capture();
    await runCatalog(["show", "recipe/workshop-selection", "--raw"]);
    expect(output.join("")).toBe(expected);
  });

  test("commands do not modify the current project", async () => {
    const root = resolve(import.meta.dirname, "../../..");
    const before = await treeDigest(resolve(root, "packages/catalog/tests"));
    const { restore } = capture();
    await runCatalog(["list"]);
    await runCatalog(["show", "recipe/workshop-selection", "--raw"]);
    await runCatalog(["source", "recipe/workshop-selection", "workshop-selection.ts", "--raw"]);
    restore();
    expect(await treeDigest(resolve(root, "packages/catalog/tests"))).toBe(before);
  });

  test.each([
    ["list", "unknown"],
    ["show"],
    ["show", "unknown"],
    ["source", "concept/selecting"],
    ["source", "concept/selecting", "unknown.ts"],
    ["add", "concept/selecting"],
    ["unknown"],
  ])("rejects invalid arguments", async (...args) => {
    await expect(runCatalog(args)).rejects.toThrow();
  });
});
