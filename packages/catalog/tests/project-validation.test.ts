import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { addEntries, diffEntries, initializeProject } from "../src/project.ts";
import { supportedCoreVersion } from "../src/registry.ts";

let directory = "";
const noSelections = { variants: new Map<string, string>() };
const coreVersion = await supportedCoreVersion();
type LockCase = readonly [string, (lock: any) => unknown, string];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "catalog-validation-"));
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify({
      private: true,
      dependencies: { "@mit-sdg/sync-engine": coreVersion },
    })}\n`,
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("catalog project path validation", () => {
  test.each([
    [{ concepts: "" }, "project-relative portable path"],
    [{ concepts: "/absolute" }, "project-relative portable path"],
    [{ concepts: "../outside" }, "project-relative portable path"],
    [{ concepts: "src//concepts" }, "project-relative portable path"],
    [{ concepts: "src/bad:name" }, "non-portable path segment"],
    [{ concepts: "src/con" }, "non-portable path segment"],
    [{ concepts: "src/trailing." }, "non-portable path segment"],
    [{ conceptSet: "src/concept-set.js" }, "must be a .ts file"],
    [{ declarations: "src/catalog/text.ts" }, "must be a .d.ts file"],
    [
      { conceptSet: "src/same.ts", registrations: "src/same.ts" },
      "managed and integration files must use distinct paths",
    ],
  ] as const)("rejects non-portable init path %#", async (paths, message) => {
    await expect(initializeProject(directory, paths, [], noSelections)).rejects.toThrow(message);
  });

  test("requires a compatible target package", async () => {
    await rm(join(directory, "package.json"));
    await expect(initializeProject(directory, {}, [], noSelections)).rejects.toThrow(
      "requires a package.json",
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ dependencies: { "@mit-sdg/sync-engine": "0.0.0" } }),
    );
    await expect(initializeProject(directory, {}, [], noSelections)).rejects.toThrow(
      "bun add --exact",
    );
  });

  test("accepts a compatible workspace dependency from an ancestor install", async () => {
    const project = join(directory, "packages/application");
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, "package.json"),
      `${JSON.stringify({ dependencies: { "@mit-sdg/sync-engine": "workspace:*" } })}\n`,
    );
    const installed = join(directory, "node_modules/@mit-sdg/sync-engine");
    await mkdir(installed, { recursive: true });
    await writeFile(
      join(installed, "package.json"),
      `${JSON.stringify({ version: coreVersion })}\n`,
    );

    await expect(
      initializeProject(project, {}, ["concept/preferring"], noSelections),
    ).resolves.toMatchObject({ initialized: true });
  });

  test("rejects write targets that contain catalog metadata", async () => {
    await expect(
      initializeProject(
        directory,
        { concepts: "catalog.lock" },
        ["concept/preferring"],
        noSelections,
      ),
    ).rejects.toThrow("write plan contains overlapping targets");
    await expect(readFile(join(directory, "catalog.lock"), "utf8")).rejects.toThrow();
  });

  test("finds initialized metadata from a nested directory", async () => {
    await initializeProject(directory, {}, [], noSelections);
    const nested = join(directory, "deep/path");
    await mkdir(nested, { recursive: true });
    await addEntries(nested, ["concept/preferring"], noSelections);
    await expect(
      readFile(join(directory, "src/concepts/preferring/preferring.ts"), "utf8"),
    ).resolves.toContain("PreferringConcept");
  });

  test("refuses to initialize over existing metadata", async () => {
    await initializeProject(directory, {}, [], noSelections);
    await expect(initializeProject(directory, {}, [], noSelections)).rejects.toThrow(
      "catalog.lock already exists",
    );
  });
});

describe("catalog lock validation", () => {
  test.each([
    ["null lock", (_lock: any) => null, "must contain an object"],
    ["unknown root field", (lock: any) => ({ ...lock, extra: true }), "unknown fields"],
    ["path map", (lock: any) => ({ ...lock, paths: null }), "paths must be an object"],
    [
      "unknown path",
      (lock: any) => ({ ...lock, paths: { extra: "src/extra" } }),
      "paths has unknown fields",
    ],
    [
      "path shape",
      (lock: any) => ({ ...lock, paths: { concepts: 7 } }),
      "paths.concepts must be a string",
    ],
    ["schema", (lock: any) => ({ ...lock, schema: 2 }), "not a supported catalog lock"],
    ["entry map", (lock: any) => ({ ...lock, entries: [] }), "not a supported catalog lock"],
    [
      "entry id",
      (lock: any) => ({ ...lock, entries: { bad: Object.values(lock.entries)[0] } }),
      "invalid entry",
    ],
    [
      "entry record",
      (lock: any) => ({ ...lock, entries: { "concept/preferring": null } }),
      "invalid entry",
    ],
    [
      "entry field",
      (lock: any) => {
        lock.entries["concept/preferring"].extra = true;
        return lock;
      },
      "unknown fields",
    ],
    [
      "entry shape",
      (lock: any) => {
        lock.entries["concept/preferring"].sourceDigest = "bad";
        return lock;
      },
      "malformed entry",
    ],
    [
      "variant",
      (lock: any) => {
        lock.entries["concept/preferring"].variant = "BAD";
        return lock;
      },
      "invalid variant",
    ],
    [
      "package",
      (lock: any) => {
        lock.entries["concept/preferring"].packages = { BAD: "1" };
        return lock;
      },
      "invalid package requirement",
    ],
    [
      "file record",
      (lock: any) => {
        lock.entries["concept/preferring"].files[0] = null;
        return lock;
      },
      "invalid file",
    ],
    [
      "file field",
      (lock: any) => {
        lock.entries["concept/preferring"].files[0].extra = true;
        return lock;
      },
      "unknown fields",
    ],
    [
      "file shape",
      (lock: any) => {
        lock.entries["concept/preferring"].files[0].hash = "bad";
        return lock;
      },
      "invalid file",
    ],
    [
      "absolute file source",
      (lock: any) => {
        lock.entries["concept/preferring"].files[0].source = "/outside.ts";
        return lock;
      },
      "invalid file",
    ],
    [
      "integration record",
      (lock: any) => {
        lock.entries["concept/preferring"].integration = null;
        return lock;
      },
      "invalid integration",
    ],
    [
      "concept integration",
      (lock: any) => {
        lock.entries["concept/preferring"].integration.name = "bad-name";
        return lock;
      },
      "invalid concept integration",
    ],
    [
      "unknown integration",
      (lock: any) => {
        lock.entries["concept/preferring"].integration.kind = "unknown";
        return lock;
      },
      "unknown integration",
    ],
    [
      "missing integration",
      (lock: any) => {
        delete lock.entries["concept/preferring"].integration;
        return lock;
      },
      "missing integration metadata",
    ],
    [
      "missing variant",
      (lock: any) => {
        delete lock.entries["concept/preferring"].variant;
        return lock;
      },
      "invalid variant metadata",
    ],
    [
      "duplicate file",
      (lock: any) => {
        const entry = lock.entries["concept/preferring"];
        entry.files.push({ ...entry.files[0] });
        return lock;
      },
      "repeats a copied target",
    ],
    [
      "missing dependency",
      (lock: any) => {
        lock.entries["concept/preferring"].requires = ["concept/missing"];
        return lock;
      },
      "requires missing entry",
    ],
  ] satisfies readonly LockCase[])("rejects malformed %s", async (_name, edit, message) => {
    await initializeProject(directory, {}, ["concept/preferring"], noSelections);
    const path = join(directory, "catalog.lock");
    const lock = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, `${JSON.stringify(edit(lock), null, 2)}\n`);
    await expect(addEntries(directory, ["concept/notifying"], noSelections)).rejects.toThrow(
      message,
    );
  });
});

describe("catalog selection failures", () => {
  test("rejects unknown, repeated, and unused selections", async () => {
    await initializeProject(directory, {}, [], noSelections);
    await expect(addEntries(directory, ["concept/unknown"], noSelections)).rejects.toThrow(
      "Unknown catalog entry",
    );
    await expect(
      addEntries(directory, ["concept/preferring", "concept/preferring"], noSelections),
    ).rejects.toThrow("operands must be unique");
    await expect(
      addEntries(directory, ["concept/preferring"], {
        variants: new Map([["concept/profiling", "memory"]]),
      }),
    ).rejects.toThrow("not used by this install");
  });

  test("rejects invalid variant and filename choices", async () => {
    await initializeProject(directory, {}, [], noSelections);
    await expect(
      addEntries(directory, ["concept/profiling"], {
        variants: new Map([["concept/profiling", "missing"]]),
      }),
    ).rejects.toThrow("has variants");
    await expect(
      addEntries(directory, ["recipe/account-center"], {
        variants: new Map([["concept/profiling", "memory"]]),
        recipeFile: "Bad.ts",
      }),
    ).rejects.toThrow("lowercase kebab-case");
  });

  test("reports missing copied files in diff", async () => {
    await initializeProject(directory, {}, ["concept/preferring"], noSelections);
    await rm(join(directory, "src/concepts/preferring/preferring.ts"));
    const result = await diffEntries(directory, ["concept/preferring"]);
    expect(result.output).toContain("(missing)");
  });
});
