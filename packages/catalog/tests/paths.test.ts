import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vite-plus/test";
import {
  assertNoSymlinkTraversal,
  assertPortablePath,
  portablePath,
  within,
} from "../src/paths.ts";

describe("catalog paths", () => {
  test("accepts local portable paths and rejects traversal and device names", () => {
    expect(portablePath("src/concepts/value.ts")).toBe(true);
    expect(() => within("/tmp/project", "..local/value.ts")).not.toThrow();
    for (const path of ["", "/absolute", "../outside", "src\\value", "src//value", "src/CON/file"])
      expect(portablePath(path)).toBe(false);
    expect(() => assertPortablePath("../outside")).toThrow("portable");
    expect(() => within("/tmp/project", "../outside")).toThrow();
  });

  test("rejects traversal through an existing symlink", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-paths-"));
    const outside = await mkdtemp(join(tmpdir(), "catalog-outside-"));
    try {
      await mkdir(join(root, "src"));
      await symlink(outside, join(root, "src/concepts"), "dir");
      await expect(
        assertNoSymlinkTraversal(root, join(root, "src/concepts/value.ts")),
      ).rejects.toThrow("symlink");
      await expect(
        assertNoSymlinkTraversal(root, join(root, "new/value.ts")),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
