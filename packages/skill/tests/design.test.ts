import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  DesignDigestError,
  digestDesign,
  requireDesignDigest,
} from "../skills/sync-engine/scripts/design.ts";
import { readAudit, responseContract } from "../skills/sync-engine/scripts/workspace.ts";

const temporary: string[] = [];

async function designFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "sync-engine-skill-design-"));
  temporary.push(root);
  await mkdir(resolve(root, "concepts"));
  await mkdir(resolve(root, "compositions"));
  await writeFile(resolve(root, "purpose.md"), "# Brief\n");
  await writeFile(resolve(root, "types.md"), "```types\n```\n");
  await writeFile(resolve(root, "concepts/Tasks.md"), "# Tasks\n");
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
    await writeFile(resolve(root, "concepts/Tasks.md"), "# Tasks\n\nChanged.\n");
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

  test("requires a concept file to carry its concept's name", async () => {
    const root = await designFixture();
    await writeFile(resolve(root, "concepts/counting.md"), "# Counting\n");
    await expect(digestDesign(root)).rejects.toThrow(
      "Concept file name does not match its concept: concepts/counting.md declares Counting; rename it to concepts/Counting.md",
    );

    await rm(resolve(root, "concepts/counting.md"));
    await writeFile(resolve(root, "concepts/Counting.md"), "no heading\n");
    await expect(digestDesign(root)).rejects.toThrow(
      "Concept declares no name heading: concepts/Counting.md",
    );

    await writeFile(resolve(root, "concepts/Counting.md"), "# Counting\n");
    expect((await digestDesign(root)).files).toBe(5);
  });
});

describe("role return contract", () => {
  test("accepts the clean sentinel and a bare findings list from a critic", () => {
    expect(responseContract("critic", "No material findings.\n")).toBeUndefined();
    expect(
      responseContract("critic", "- `design/concepts/Shortening.md` — Undeclared branch.\n"),
    ).toBeUndefined();
  });

  test("accepts the fenced form its own prompt shows", () => {
    expect(responseContract("critic", "```text\nNo material findings.\n```")).toBeUndefined();
    expect(
      responseContract("critic", "```\n- `design/types.md` — Undeclared branch.\n```\n"),
    ).toBeUndefined();
  });

  test("refuses a critic that buries its verdict under a preamble", () => {
    expect(
      responseContract("critic", "I reviewed the four files.\n\nNo material findings.\n"),
    ).toContain("no preamble");
  });

  test("refuses any role that returns nothing", () => {
    expect(responseContract("application-worker", "   \n")).toContain("returned nothing");
    expect(
      responseContract("application-worker", "Changed src/assembly.ts; check passed."),
    ).toBeUndefined();
  });
});

describe("role read boundary", () => {
  test("keeps the designer out of installed dependencies", () => {
    expect(
      readAudit("designer", [
        "design/concepts/Shortening.md",
        "node_modules/@mit-sdg/sync-engine/examples/message-board/src/host.ts",
      ]),
    ).toEqual(["node_modules/@mit-sdg/sync-engine/examples/message-board/src/host.ts"]);
  });

  test("keeps every role out of the skill's own sources", () => {
    const skill = resolve("packages/skill/skills/sync-engine");
    for (const role of ["designer", "critic", "application-worker"]) {
      expect(readAudit(role, [`${skill}/prompts/inputs/http.md`], skill)).toHaveLength(1);
      expect(readAudit(role, [`${skill}/scripts/command.ts`], skill)).toHaveLength(1);
    }
    // An application's own prompt library is its own business.
    expect(
      readAudit(
        "application-worker",
        ["prompts/templates/welcome.md", "src/skills/x/scripts/a.ts"],
        skill,
      ),
    ).toEqual([]);
  });

  test("lets implementation roles read examples and user docs, nothing else", () => {
    expect(
      readAudit("concept-worker", [
        "src/concepts/Shortening.ts",
        "node_modules/@mit-sdg/sync-engine/examples/message-board/src/concepts/Posting.ts",
        "node_modules/@mit-sdg/sync-engine/docs/user/guide/authoring.md",
        "node_modules/some-other-package/index.js",
      ]),
    ).toEqual([]);
    expect(
      readAudit("application-worker", ["node_modules/@mit-sdg/sync-engine/dist/command/main.js"]),
    ).toEqual(["node_modules/@mit-sdg/sync-engine/dist/command/main.js"]);
  });
});
