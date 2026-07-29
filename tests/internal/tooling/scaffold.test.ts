import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { scaffoldProject } from "@command/scaffold";
import { conceptFailures } from "@command/check";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sync-engine-new-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("sync-engine new", () => {
  test("writes a project whose names follow the directory", async () => {
    const project = join(directory, "note-keeper");
    const written = await scaffoldProject(project);

    expect(written).toContain("generated.config.ts");
    expect(written).toContain("src/concepts/noting/spec.md");

    const config = await readFile(join(project, "generated.config.ts"), "utf8");
    expect(config).toContain('title: "Note keeper"');
    // Everything else follows from the title and the config's own location.
    expect(config).not.toContain("wireName");
    expect(config).not.toContain("directory");

    const assembly = await readFile(join(project, "src/assembly.ts"), "utf8");
    expect(assembly).toContain("export function assembleNoteKeeper()");

    const generatedManifest = JSON.parse(await readFile(join(project, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      engines: Record<string, string>;
      packageManager: string;
    };
    const packageManifest = JSON.parse(
      await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as {
      version: string;
      dependencies: Record<string, string>;
      engines: Record<string, string>;
      packageManager: string;
    };
    expect(generatedManifest.dependencies["@mit-sdg/sync-engine"]).toBe(packageManifest.version);
    expect(generatedManifest.devDependencies.typescript).toBe(
      packageManifest.dependencies.typescript,
    );
    expect(generatedManifest.engines).toEqual(packageManifest.engines);
    expect(generatedManifest.packageManager).toBe(packageManifest.packageManager);
  });

  test("the written concept registry names only what the specification cannot", async () => {
    const project = join(directory, "note-keeper");
    await scaffoldProject(project);

    const registry = await readFile(join(project, "src/concepts/noting/registry.ts"), "utf8");
    expect(registry).toContain("refusals: { NOTE_NOT_FOUND: NoteNotFound }");
    expect(registry).not.toContain("queries:");
    expect(registry).not.toContain("on:");

    // The specification carries the branch, its sentence, and the promises.
    const spec = await readFile(join(project, "src/concepts/noting/spec.md"), "utf8");
    expect(spec).toContain('refuse NOTE_NOT_FOUND "There is no such note."');
    expect(spec).toContain("_get (note: Note) : optional (text: String)");
  });

  test("the written concept already agrees with its specification", async () => {
    const project = join(directory, "note-keeper");
    await scaffoldProject(project);
    expect(conceptFailures(join(project, "src/concepts/noting"))).toEqual([]);
  });

  test("the default check inspects the application and the scenario covers a missing note", async () => {
    const project = join(directory, "note-keeper");
    await scaffoldProject(project);

    const manifest = await readFile(join(project, "package.json"), "utf8");
    expect(manifest).toContain("sync-engine check --config generated.config.ts");

    const composition = await readFile(join(project, "src/composition.ts"), "utf8");
    expect(composition).toContain('respond({ error: "NOTE_NOT_FOUND" })');
    expect(composition).toContain("no(Noting._get({ note }))");

    const scenario = await readFile(join(project, "src/scenario.ts"), "utf8");
    expect(scenario).toContain('notes.notes.get({ note: "missing-note" })');
    expect(scenario).toContain('missing.error !== "NOTE_NOT_FOUND"');
    expect(scenario).not.toContain("FORMER_NONE");
    expect(scenario).not.toContain("INTERNAL_ERROR");
  });

  test("refuses to overwrite a file that is already there", async () => {
    const project = join(directory, "note-keeper");
    await scaffoldProject(project);
    await writeFile(join(project, "README.md"), "mine");

    await expect(scaffoldProject(project)).rejects.toThrow(
      /already contains .*refusing to overwrite/,
    );
    expect(await readFile(join(project, "README.md"), "utf8")).toBe("mine");
  });

  test.each(["123", "---", "Bad-Name", "bad_name", "bad--name", "bad-"])(
    "rejects invalid project name %s before creating it",
    async (name) => {
      const project = join(directory, name);
      await expect(scaffoldProject(project)).rejects.toThrow(
        /must begin with a lowercase letter.*single hyphens/,
      );
      expect(existsSync(project)).toBe(false);
    },
  );

  test.each(["con", "com1", "lpt9"])("rejects reserved project name %s", async (name) => {
    const project = join(directory, name);
    await expect(scaffoldProject(project)).rejects.toThrow(/reserved Windows device name/);
    expect(existsSync(project)).toBe(false);
  });
});
