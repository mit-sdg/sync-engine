import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  DesignDigestError,
  digestDesign,
  requireDesignDigest,
} from "../skills/sync-engine/scripts/design.ts";

const temporary: string[] = [];

async function designFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-design-"));
  temporary.push(root);
  await mkdir(resolve(root, "concepts"));
  await mkdir(resolve(root, "compositions"));
  await writeFile(resolve(root, "purpose.md"), "# Brief\n");
  await writeFile(resolve(root, "types.md"), "```types\n```\n");
  await writeFile(resolve(root, "concepts/tasks.md"), "# Tasks\n");
  await writeFile(resolve(root, "compositions/app.md"), "# Application\n");
  return root;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("closed design digest", () => {
  test("is deterministic and changes with authored Markdown", async () => {
    const root = await designFixture();
    const first = await digestDesign(root);
    const second = await digestDesign(root);
    expect(second).toEqual(first);
    expect(first.files).toBe(4);
    expect(first.digest).toMatch(/^[a-f0-9]{64}$/);

    await requireDesignDigest(root, first.digest);
    await writeFile(resolve(root, "concepts/tasks.md"), "# Tasks\n\nChanged.\n");
    await expect(requireDesignDigest(root, first.digest)).rejects.toThrow("Design digest changed");
  });

  test("ignores non-Markdown files and rejects symbolic links", async () => {
    const root = await designFixture();
    const first = await digestDesign(root);
    await writeFile(resolve(root, "notes.txt"), "not authored authority");
    expect(await digestDesign(root)).toEqual(first);

    await symlink(resolve(root, "purpose.md"), resolve(root, "linked.md"));
    await expect(digestDesign(root)).rejects.toBeInstanceOf(DesignDigestError);
  });
});
