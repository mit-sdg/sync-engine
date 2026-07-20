import { readFile, stat } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import { applicationExamples } from "../../examples/register.ts";

const root = new URL("../../", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

function table(document: string, header: string): string {
  const start = document.indexOf(header);
  if (start < 0) throw new Error(`missing table header: ${header}`);
  const end = document.indexOf("\n\n", start);
  return document.slice(start, end < 0 ? undefined : end);
}

describe("documented inventories", () => {
  test("the public API package subpaths match the package export register", async () => {
    const packageJson = JSON.parse(await text("package.json")) as {
      exports: Record<string, unknown>;
    };
    const tsconfig = JSON.parse(await text("tsconfig.json")) as {
      compilerOptions: { paths: Record<string, string[]> };
    };
    const subpaths = Object.keys(packageJson.exports)
      .map((path) => path.replace(/^\.\//, ""))
      .sort();

    const publicSurface = await text("docs/public-surface.md");
    const documented = [...publicSurface.matchAll(/^## `([^`]+)`$/gm)]
      .map((match) => match[1])
      .sort();
    expect(documented).toEqual(subpaths);

    expect(tsconfig.compilerOptions.paths["@mit-sdg/sync-engine/*"]).toEqual(["./src/*/index.ts"]);
    for (const subpath of subpaths) {
      await expect(stat(new URL(`src/${subpath}/index.ts`, root))).resolves.toBeDefined();
    }
  });

  test("every application example has the package, repository, and README seats", async () => {
    const registered = Object.values(applicationExamples);
    const examplesReadme = await text("examples/README.md");

    for (const { directory, generated } of registered) {
      expect(examplesReadme).toContain(`(${directory}/README.md)`);
      const applicationReadme = await text(`examples/${directory}/README.md`);
      for (const artifact of generated) expect(applicationReadme).toContain(`(${artifact})`);
      expect(applicationReadme).toContain("(generated/README.md)");
      await expect(
        stat(new URL(`tests/examples/${directory}.test.ts`, root)),
      ).resolves.toBeDefined();
    }
  });

  test("the router leaves inventories in their reference homes", async () => {
    const docsIndex = await text("docs/README.md");
    const guide = await text("docs/guide/views-and-formers.md");
    const publicSurface = await text("docs/public-surface.md");

    expect(docsIndex).not.toContain("| Construction |");
    expect(docsIndex).not.toContain("| Package path");
    expect(guide).not.toContain("| Consumer");
    expect(table(publicSurface, "| Consumer")).toContain("`.count()`");
  });
});
