import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import { usage } from "../src/cli.ts";
import { defaultConfig } from "../src/project.ts";
import { loadCatalog } from "../src/registry.ts";

const root = new URL("../", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

describe("catalog documentation", () => {
  test("the package remains CLI-only", async () => {
    const manifest = JSON.parse(await text("package.json")) as {
      bin: Record<string, string>;
      exports: Record<string, unknown>;
      files: string[];
    };
    expect(manifest.bin).toEqual({ catalog: "./dist/command.js" });
    expect(manifest.exports).toEqual({});
    expect(manifest.files).toEqual(
      expect.arrayContaining(["CONTRIBUTING.md", "README.md", "public-surface.md"]),
    );
  });

  test("the public surface covers every command, option, path, and lock field", async () => {
    const surface = await text("public-surface.md");
    for (const command of ["list", "show", "init", "add", "diff", "forget"]) {
      expect(usage).toContain(`catalog ${command}`);
      expect(surface).toContain(`catalog ${command}`);
    }
    for (const option of new Set(usage.match(/--[a-z-]+/g) ?? [])) {
      expect(surface, option).toContain(option);
    }
    for (const [field, value] of Object.entries(defaultConfig)) {
      expect(surface, field).toContain(`\`${field}\``);
      expect(surface, value).toContain(`\`${value}\``);
    }
    for (const field of [
      "kind",
      "catalogVersion",
      "sourceDigest",
      "requires",
      "packages",
      "variant",
      "files",
      "integration",
    ]) {
      expect(surface, field).toContain(`\`${field}\``);
    }
    for (const id of (await loadCatalog()).keys()) {
      expect(surface, id).toContain(`\`${id}\``);
    }
  });

  test("the README routes exact contracts and contribution work locally", async () => {
    const readme = await text("README.md");
    expect(readme).toContain("(public-surface.md)");
    expect(readme).toContain("(CONTRIBUTING.md)");
    expect(readme).toContain(
      "catalog init recipe/account-center --variant concept/profiling=memory",
    );
    expect(readme).not.toContain("bundle/account-center");
    expect(readme).not.toContain("catalog.json");
  });
});
