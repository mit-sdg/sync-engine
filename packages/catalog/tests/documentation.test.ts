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
});
