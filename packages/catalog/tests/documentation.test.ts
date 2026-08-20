import { readFile, readdir } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

describe("catalog documentation", () => {
  test("documents the complete read-only command contract", async () => {
    const reference = await readFile(new URL("../public-surface.md", import.meta.url), "utf8");
    for (const term of [
      "sync-engine-catalog list",
      "sync-engine-catalog show",
      "sync-engine-catalog source",
      "--raw",
      "stdout",
      "never writes",
      "schema: 2",
      "implementations",
      "selector",
      "simplify",
      "split",
      "combine",
      "rename",
    ])
      expect(reference).toContain(term);
    for (const removed of [
      "`catalog` executable",
      "sync-engine-catalog add",
      "catalog.lock",
      "generated.ts",
      "src/concept-set.ts",
    ])
      expect(reference).not.toContain(removed);
  });

  test("keeps every recipe on the structured design and export convention", async () => {
    const root = new URL("../entries/recipe/", import.meta.url);
    for (const name of await readdir(root)) {
      const source = await readFile(new URL(`${name}/${name}.ts`, root), "utf8");
      const spec = await readFile(new URL(`${name}/spec.md`, root), "utf8");

      expect(source).toContain('import spec from "./spec.md" with { type: "text" };');
      expect(source).toContain("export { spec };");
      expect(source).not.toMatch(/export \{ design \}|export const (?!compositions|views|formers)/);
      expect(spec).toContain("## Application types and instances");
      expect(spec).toContain("```instances");
      expect(spec).toContain("## Compositions");
      expect(spec).not.toMatch(
        /^## (Purpose|Concepts|Decisions|Endpoints|Failure|Failure and repair|Host variants)$/m,
      );
      expect(spec).not.toMatch(/\/[-a-z]+\//);

      const compositionBlock = source.match(/export const compositions = \{([\s\S]*?)\n\};/)?.[1];
      expect(compositionBlock).toBeDefined();
      for (const group of compositionBlock?.matchAll(/^  (\w+):/gm) ?? [])
        expect(spec).toContain(`### ${group[1]}`);
      for (const aggregate of ["views", "formers"])
        for (const names of source
          .match(new RegExp(`export const ${aggregate} = \\{ ([^}]+) \\};`))?.[1]
          ?.split(",") ?? [])
          expect(spec).toContain(`### ${names.trim()}`);
    }
  });

  test.each(["gathering", "selecting"])(
    "keeps the %s concept design byte-identical in both tutorial examples",
    async (concept) => {
      const catalog = await readFile(
        new URL(`../entries/concept/${concept}/spec.md`, import.meta.url),
        "utf8",
      );
      for (const example of ["reading-circle", "operations-room"])
        expect(
          await readFile(
            new URL(
              `../../../examples/${example}/design/concepts/${concept[0]?.toUpperCase()}${concept.slice(1)}.md`,
              import.meta.url,
            ),
            "utf8",
          ),
        ).toBe(catalog);
    },
  );
});
