import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vite-plus/test";

describe("catalog documentation", () => {
  test("documents the complete read-only command contract", async () => {
    const reference = await readFile(new URL("../public-surface.md", import.meta.url), "utf8");
    for (const term of [
      "catalog list",
      "catalog show",
      "catalog source",
      "--raw",
      "stdout",
      "never writes",
      "schema: 2",
      "implementations",
      "selector",
    ])
      expect(reference).toContain(term);
    for (const removed of ["catalog add", "catalog.lock", "generated.ts", "src/concept-set.ts"])
      expect(reference).not.toContain(removed);
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
              `../../../examples/${example}/src/concepts/${concept}/spec.md`,
              import.meta.url,
            ),
            "utf8",
          ),
        ).toBe(catalog);
    },
  );
});
