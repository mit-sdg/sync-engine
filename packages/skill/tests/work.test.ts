import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import {
  briefFileName,
  canonicalPath,
  policyFileName,
  readWorkPolicy,
  requirePathInWorkUnit,
  requireWorkUnit,
  reserveRunArtifacts,
  startWorkUnit,
  startWorkUnitFromTemplate,
  utcRunTimestamp,
  workRoot,
  workUnitPath,
} from "../skills/sync-engine/scripts/work.ts";
import { rejectedValue, thrownValue } from "./test-support.ts";

const temporary: string[] = [];

async function temporaryDirectory(label: string): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), `sync-engine-skill-${label}-`));
  temporary.push(path);
  return path;
}

async function application(): Promise<string> {
  return temporaryDirectory("work");
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("work-unit paths", () => {
  test("accepts only safe, contained slugs", async () => {
    const root = await application();
    expect(workUnitPath(root, "message-board")).toBe(
      resolve(canonicalPath(root), ".sync-engine/work/message-board"),
    );

    for (const slug of ["", ".", "..", "../escape", "a/b", "/absolute", "UPPER", "a--b"]) {
      expect(thrownValue(() => workUnitPath(root, slug))).toEqual({
        name: "WorkError",
        message: "Work slug must be 1-80 characters of lowercase kebab case",
      });
    }
  });

  test("rejects a work root whose symlink escapes the application", async () => {
    const root = await application();
    const outside = await temporaryDirectory("outside");
    await mkdir(resolve(root, ".sync-engine"));
    await symlink(outside, resolve(root, ".sync-engine/work"), "dir");

    const message = `Work root escapes the application: ${resolve(
      canonicalPath(root),
      ".sync-engine/work",
    )} resolves to ${canonicalPath(outside)}`;
    expect(thrownValue(() => workRoot(root))).toEqual({ name: "WorkError", message });
    expect(
      await rejectedValue(
        startWorkUnit({ applicationRoot: root, slug: "escaped", briefTemplate: "# Brief\n" }),
      ),
    ).toEqual({ name: "WorkError", message });
    await expect(readFile(resolve(outside, "escaped/brief.md"))).rejects.toThrow();
  });

  test("rejects work-unit aliases and artifact symlink escapes", async () => {
    const root = await application();
    const outside = await temporaryDirectory("outside");
    await mkdir(resolve(root, ".sync-engine/work"), { recursive: true });
    await symlink(outside, resolve(root, ".sync-engine/work/alias"), "dir");

    expect(await rejectedValue(requireWorkUnit(root, "alias"))).toEqual({
      name: "WorkError",
      message: "Work unit escapes its work root: alias",
    });
    const aliasFile = resolve(root, ".sync-engine/work/alias/file.md");
    const work = workRoot(root);
    expect(thrownValue(() => requirePathInWorkUnit(aliasFile, work))).toEqual({
      name: "WorkError",
      message: `Workflow artifact escapes work unit ${work}: ${aliasFile}`,
    });

    const unit = await startWorkUnit({
      applicationRoot: root,
      slug: "contained",
      briefTemplate: "# Brief\n",
    });
    const linked = resolve(unit.path, "linked.prompt.md");
    await writeFile(resolve(outside, "prompt.md"), "outside");
    await symlink(resolve(outside, "prompt.md"), linked);
    expect(thrownValue(() => requirePathInWorkUnit(linked, unit.path))).toEqual({
      name: "WorkError",
      message: `Workflow artifact escapes work unit ${unit.path}: ${linked}`,
    });
  });
});

describe("work start", () => {
  test("creates the work root and copies the supplied brief verbatim", async () => {
    const root = await application();
    const template = "# Goal\r\n\r\nKeep these bytes.\r\n";
    const unit = await startWorkUnit({
      applicationRoot: root,
      slug: "record-mechanics",
      briefTemplate: template,
    });

    expect(unit.path).toBe(workUnitPath(root, "record-mechanics"));
    expect(unit.briefPath).toBe(resolve(unit.path, briefFileName));
    expect(unit.policyPath).toBe(resolve(unit.path, policyFileName));
    expect(await readFile(unit.briefPath, "utf8")).toBe(template);
    expect(await readWorkPolicy(unit)).toEqual({ review: "required", execution: "mixed" });
  });

  test("records one immutable review and execution policy", async () => {
    const root = await application();
    const unit = await startWorkUnit({
      applicationRoot: root,
      slug: "fixed-policy",
      briefTemplate: "# Brief\n",
      policy: { review: "omitted", execution: "simulated" },
    });
    expect(await readWorkPolicy(unit)).toEqual({ review: "omitted", execution: "simulated" });
  });

  test("copies from a template path and never overwrites an existing unit", async () => {
    const root = await application();
    const templatePath = resolve(root, "brief-template.md");
    await writeFile(templatePath, "# Initial brief\n", "utf8");
    const unit = await startWorkUnitFromTemplate({
      applicationRoot: root,
      slug: "no-overwrite",
      briefTemplatePath: templatePath,
    });
    await writeFile(unit.briefPath, "# User edits\n", "utf8");

    expect(
      await rejectedValue(
        startWorkUnit({
          applicationRoot: root,
          slug: "no-overwrite",
          briefTemplate: "# Replacement\n",
        }),
      ),
    ).toEqual({ name: "WorkError", message: "Work unit already exists: no-overwrite" });
    expect(await readFile(unit.briefPath, "utf8")).toBe("# User edits\n");
  });

  test("does not create a unit from an empty template", async () => {
    const root = await application();
    expect(
      await rejectedValue(
        startWorkUnit({ applicationRoot: root, slug: "empty", briefTemplate: " \n\t" }),
      ),
    ).toEqual({ name: "WorkError", message: "Brief template is empty" });
    expect(await rejectedValue(requireWorkUnit(root, "empty"))).toEqual({
      name: "WorkError",
      message: "Work unit does not exist: empty",
    });
  });
});

describe("run artifacts", () => {
  test("uses a readable UTC stem and deterministic collision suffixes", async () => {
    expect(utcRunTimestamp(new Date("2026-08-19T09:06:43.512Z"))).toBe("2026-08-19T09-06-43Z");
    const root = await application();
    const unit = await startWorkUnit({
      applicationRoot: root,
      slug: "timestamps",
      briefTemplate: "# Brief\n",
    });
    const at = new Date("2026-08-19T09:06:43.512Z");

    const first = await reserveRunArtifacts({
      applicationRoot: root,
      slug: unit.slug,
      role: "concept-worker",
      phase: "implementation",
      at,
    });
    const second = await reserveRunArtifacts({
      applicationRoot: root,
      slug: unit.slug,
      role: "concept-worker",
      phase: "implementation",
      at,
    });
    await writeFile(
      resolve(unit.path, `${first.stem}-3.prompt.md`),
      "pre-existing collision",
      "utf8",
    );
    const fourth = await reserveRunArtifacts({
      applicationRoot: root,
      slug: unit.slug,
      role: "concept-worker",
      phase: "implementation",
      at,
    });

    expect(first.stem).toBe("2026-08-19T09-06-43Z-concept-worker-implementation");
    expect(second.stem).toBe(`${first.stem}-2`);
    expect(fourth.stem).toBe(`${first.stem}-4`);
    expect(await readFile(first.responsePath, "utf8")).toBe("");

    for (const [suffix, path] of [
      ["task.md", first.taskPath],
      ["capabilities.json", first.capabilitiesPath],
      ["baseline.json", first.baselinePath],
      ["prompt.md", first.promptPath],
      ["response.md", first.responsePath],
      ["record.json", first.recordPath],
    ] as const) {
      expect(dirname(path)).toBe(unit.path);
      expect(basename(path)).toBe(`${first.stem}.${suffix}`);
    }
  });

  test("rejects unsafe role and phase labels", async () => {
    const root = await application();
    await startWorkUnit({
      applicationRoot: root,
      slug: "safe-run",
      briefTemplate: "# Brief\n",
    });

    expect(
      await rejectedValue(
        reserveRunArtifacts({
          applicationRoot: root,
          slug: "safe-run",
          role: "../critic",
          phase: "review",
        }),
      ),
    ).toEqual({
      name: "WorkError",
      message: "Run role must be 1-80 characters of lowercase kebab case",
    });
    expect(
      await rejectedValue(
        reserveRunArtifacts({
          applicationRoot: root,
          slug: "safe-run",
          role: "critic",
          phase: "review/repair",
        }),
      ),
    ).toEqual({
      name: "WorkError",
      message: "Run phase must be 1-80 characters of lowercase kebab case",
    });
  });
});
