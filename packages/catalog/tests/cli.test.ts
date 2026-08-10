import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { runCatalog } from "../src/cli.ts";

describe("catalog CLI", () => {
  afterEach(() => vi.restoreAllMocks());
  test("lists and shows entries without loading core", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
    await runCatalog(["list", "recipe"]);
    await runCatalog(["show", "recipe/workshop-selection"]);
    await runCatalog(["show", "concept/selecting"]);
    expect(output.join("\n")).toContain("recipe/workshop-selection");
    expect(output.join("\n")).toContain("/workshops/create");
    expect(output.join("\n")).toContain("Floor mongo");
  });
  test("prints help and filters concepts", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
    await runCatalog(["help"]);
    await runCatalog(["list", "concept"]);
    expect(output.join("\n")).toContain("Usage: catalog");
    expect(output.join("\n")).toContain("concept/selecting");
  });

  test.each([
    [["list", "unknown"]],
    [["show"]],
    [["show", "unknown"]],
    [["add"]],
    [["add", "concept/selecting", "--unknown"]],
    [["add", "concept/selecting", "--floor", ""]],
    [["unknown"]],
  ])("rejects invalid arguments %j", async (args) => {
    await expect(runCatalog(args)).rejects.toThrow();
  });

  test("prints package guidance for an add that cannot proceed", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-cli-"));
    const output: string[] = [];
    try {
      await writeFile(join(root, "package.json"), '{"name":"fixture"}\n');
      vi.spyOn(process, "cwd").mockReturnValue(root);
      vi.spyOn(console, "log").mockImplementation((value) => output.push(String(value)));
      await runCatalog(["add", "concept/selecting"]);
      expect(output.join("\n")).toContain("bun add --exact");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = 0;
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects repeated floors during parsing", async () => {
    await expect(
      runCatalog(["add", "concept/selecting", "--floor", "memory", "--floor", "mongo"]),
    ).rejects.toThrow("only once");
  });
});
