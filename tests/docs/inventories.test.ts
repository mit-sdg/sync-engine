import { readFile, stat } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";
import { applicationExamples } from "@examples/register";
import { FrameworkErrorCode } from "@sync-engine/boundary";

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

function tableCells(row: string): string[] {
  return row
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
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

  test("every application example is a documented, self-contained package", async () => {
    const registered = Object.values(applicationExamples);
    const examplesReadme = await text("examples/README.md");

    for (const { directory, generated } of registered) {
      expect(examplesReadme).toContain(`(${directory}/README.md)`);
      const applicationReadme = await text(`examples/${directory}/README.md`);
      for (const artifact of generated) expect(applicationReadme).toContain(`(${artifact})`);
      for (const path of [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "text.d.ts",
        "tests/application.test.ts",
        "generated.config.ts",
      ]) {
        await expect(stat(new URL(`examples/${directory}/${path}`, root))).resolves.toBeDefined();
      }
    }
  });

  test("the root map leaves inventories in their reference homes", async () => {
    const docsIndex = await text("README.md");
    const guide = await text("docs/guide/views-and-formers.md");
    const publicSurface = await text("docs/public-surface.md");

    expect(docsIndex).not.toContain("| Construction |");
    expect(docsIndex).not.toContain("| Package path");
    expect(guide).not.toContain("| Consumer");
    expect(table(publicSurface, "| Consumer")).toContain("`.count()`");
  });

  test("reference lookup indexes and package-role links stay available", async () => {
    const book = await text("docs/book.md");
    const semantics = await text("docs/semantics.md");
    const publicSurface = await text("docs/public-surface.md");

    expect(table(book, "| Rejected attempt")).toContain("#5--no--denial");
    expect(table(semantics, "| Contract need")).toContain(
      "#logs-concept-implementations-and-restart",
    );
    for (const subpath of ["language", "assembly", "boundary", "client", "tooling", "advanced"]) {
      expect(table(publicSurface, "| Package path")).toContain(
        `[\`@mit-sdg/sync-engine/${subpath}\`](#${subpath})`,
      );
    }
  });

  test("the public API tables are well formed and list every framework error", async () => {
    const publicSurface = await text("docs/public-surface.md");
    const tables = [...publicSurface.matchAll(/^(?:\|.*\|\n?){2,}/gm)].map((match) =>
      match[0].trim(),
    );
    expect(tables.length).toBeGreaterThan(0);

    for (const markdown of tables) {
      const rows = markdown.split("\n").map(tableCells);
      expect(
        rows[1].every((cell) => /^:?-{3,}:?$/.test(cell)),
        markdown,
      ).toBe(true);
      expect(
        rows.map((row) => row.length),
        markdown,
      ).toEqual(Array.from({ length: rows.length }, () => rows[0].length));
    }

    const documentedErrors = table(publicSurface, "| Code")
      .split("\n")
      .slice(2)
      .map((row) => tableCells(row)[0].replaceAll("`", ""))
      .sort();
    expect(documentedErrors).toEqual(Object.values(FrameworkErrorCode).sort());
  });
});
