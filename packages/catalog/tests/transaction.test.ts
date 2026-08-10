import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "vite-plus/test";
import { applyTransaction, type TransactionFilesystem } from "../src/transaction.ts";

const file = (target: string, contents: string) => ({
  source: "source.ts",
  target,
  contents,
  hash: "a".repeat(64),
  class: "owned" as const,
  ownership: "entry" as const,
  entry: "concept/example",
});

describe("catalog transaction", () => {
  test("restores completed replacements when a later write fails before the lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "catalog-transaction-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await writeFile(join(root, "src/a.ts"), "old a");
      await writeFile(join(root, "src/b.ts"), "old b");
      await writeFile(join(root, "catalog.lock"), "old lock");
      const fs: TransactionFilesystem = {
        exists: existsSync,
        mkdir,
        writeFile,
        rename: async (from, to) => {
          if (from.includes(".tmp") && to.endsWith(normalize("src/b.ts")))
            throw new Error("injected rename failure");
          await rename(from, to);
        },
        rm,
      };
      await expect(
        applyTransaction(
          root,
          [file("src/a.ts", "new a"), file("src/b.ts", "new b")],
          "new lock",
          fs,
        ),
      ).rejects.toThrow("injected rename failure");
      await expect(readFile(join(root, "src/a.ts"), "utf8")).resolves.toBe("old a");
      await expect(readFile(join(root, "src/b.ts"), "utf8")).resolves.toBe("old b");
      await expect(readFile(join(root, "catalog.lock"), "utf8")).resolves.toBe("old lock");
      expect((await readdir(root)).some((name) => name.includes(".catalog-"))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
