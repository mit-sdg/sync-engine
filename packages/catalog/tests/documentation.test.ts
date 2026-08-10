import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

describe("catalog documentation", () => {
  test("covers every command and contract category", async () => {
    const reference = await readFile(new URL("../public-surface.md", import.meta.url), "utf8");
    for (const term of [
      "catalog list",
      "catalog show",
      "catalog add",
      "--floor",
      "schema",
      "defaultFloor",
      "members",
      "routes",
      "sourceDigest",
      "Copy-owned",
      "Rendered",
      "Generated",
      "Package requirements",
      "Write boundary",
    ])
      expect(reference).toContain(term);
  });

  test.each(["gathering", "selecting"])(
    "keeps the %s catalog contract byte-identical in both tutorial examples",
    async (concept) => {
      const catalog = await readFile(
        new URL(`../entries/concept/${concept}/spec.md`, import.meta.url),
        "utf8",
      );
      for (const example of ["reading-circle", "operations-room"])
        expect(
          await readFile(
            new URL(
              `../../../examples/${example}/src/concepts/${concept}/spec.md`,
              import.meta.url,
            ),
            "utf8",
          ),
        ).toBe(catalog);
    },
  );
});
