import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { runCatalog, type CatalogIO } from "../src/cli.ts";
import { addEntries, diffEntries, forgetEntries, initializeProject } from "../src/project.ts";
import { loadCatalog } from "../src/registry.ts";

let directory = "";

const noSelections = { variants: new Map<string, string>() };

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "sync-engine-catalog-"));
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(
      {
        name: "catalog-consumer",
        private: true,
        type: "module",
        scripts: { check: "tsc --noEmit" },
        dependencies: { "@mit-sdg/sync-engine": "1.0.0-beta.7" },
      },
      null,
      2,
    )}\n`,
  );
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("catalog registry", () => {
  test("loads a coherent useful entry graph", async () => {
    const catalog = await loadCatalog();
    expect([...catalog.keys()].sort()).toEqual([
      "bundle/operations-room",
      "computation/normalize-label",
      "concept/alerting",
      "concept/discussing",
      "concept/gathering",
      "concept/selecting",
      "recipe/member-contributions",
      "recipe/normalized-selection",
      "recipe/operations-dashboard",
      "recipe/selection-alerts-members",
      "recipe/selection-opens-discussion",
    ]);
    expect(catalog.get("concept/gathering")?.manifest.variants).toHaveProperty("repository");
  });
});

describe("catalog project installation", () => {
  test("requires an explicit implementation variant before its first write", async () => {
    await expect(
      initializeProject(directory, {}, ["concept/gathering"], noSelections),
    ).rejects.toThrow("--variant concept/gathering=<variant>");
    await expect(readFile(join(directory, "catalog.json"), "utf8")).rejects.toThrow();
  });

  test("renders a recipe into a customized application layout", async () => {
    const result = await initializeProject(
      directory,
      {
        concepts: "app/domain",
        computations: "app/calculations",
        recipes: "app/policies",
        conceptSet: "app/system/vocabulary.ts",
        declarations: "app/generated/text.d.ts",
        registrations: "app/generated/registrations.ts",
        composition: "app/generated/composition.ts",
      },
      ["recipe/selection-opens-discussion"],
      noSelections,
    );

    expect(result.written).toContain("app/policies/selection-opens-discussion.ts");
    const recipe = await readFile(
      join(directory, "app/policies/selection-opens-discussion.ts"),
      "utf8",
    );
    expect(recipe).toContain('from "../system/vocabulary.ts"');
    const registrations = await readFile(join(directory, "app/generated/registrations.ts"), "utf8");
    expect(registrations).toContain("Discussing: catalogConcept0");
    expect(registrations).toContain("Selecting: catalogConcept1");
    await expect(readFile(join(directory, "app/generated/text.d.ts"), "utf8")).resolves.toContain(
      'declare module "*.md"',
    );
  });

  test("recognizes a bundle's complete one-command integration", async () => {
    const result = await initializeProject(directory, {}, ["bundle/operations-room"], {
      variants: new Map([["concept/gathering", "memory"]]),
    });
    expect(result.integrationRequired).toBe(false);
  });

  test("installs and executes the repository-backed concept variant", async () => {
    await initializeProject(directory, {}, ["concept/gathering"], {
      variants: new Map([["concept/gathering", "repository"]]),
    });
    const implementation = await readFile(
      join(directory, "src/concepts/gathering/gathering.ts"),
      "utf8",
    );
    expect(implementation).toContain("export interface GatheringRepository");
    const evidence = spawnSync("bun", ["src/concepts/gathering/gathering.test.ts"], {
      cwd: directory,
      encoding: "utf8",
    });
    expect({ status: evidence.status, stderr: evidence.stderr }).toEqual({ status: 0, stderr: "" });
    expect(evidence.stdout).toContain("repository conformance holds");
  });

  test("warns about edited dependencies without overwriting them", async () => {
    await initializeProject(directory, {}, ["concept/gathering"], {
      variants: new Map([["concept/gathering", "memory"]]),
    });
    const implementation = join(directory, "src/concepts/gathering/gathering.ts");
    await writeFile(
      implementation,
      `${await readFile(implementation, "utf8")}\n// application change\n`,
    );

    const result = await addEntries(directory, ["recipe/selection-alerts-members"], noSelections);
    expect(result.warnings.join("\n")).toContain("concept/gathering has application-owned changes");
    expect(await readFile(implementation, "utf8")).toContain("application change");
  });

  test("warns when an application-owned dependency file is missing", async () => {
    await initializeProject(directory, {}, ["concept/gathering"], {
      variants: new Map([["concept/gathering", "memory"]]),
    });
    await rm(join(directory, "src/concepts/gathering/gathering.ts"));
    const result = await addEntries(directory, ["recipe/selection-alerts-members"], noSelections);
    expect(result.warnings.join("\n")).toContain("gathering.ts");
  });

  test("suggests a deterministic alternative recipe filename on collision", async () => {
    await initializeProject(directory, {}, [], noSelections);
    await mkdir(join(directory, "src/composition"), { recursive: true });
    await writeFile(join(directory, "src/composition/selection-opens-discussion.ts"), "mine\n");

    await expect(
      addEntries(directory, ["recipe/selection-opens-discussion"], noSelections),
    ).rejects.toThrow(
      "catalog add recipe/selection-opens-discussion --file selection-opens-discussion-catalog.ts",
    );
    expect(
      await readFile(join(directory, "src/composition/selection-opens-discussion.ts"), "utf8"),
    ).toBe("mine\n");
  });

  test("preserves init path options in its recipe collision retry", async () => {
    await mkdir(join(directory, "app/policies"), { recursive: true });
    await writeFile(join(directory, "app/policies/selection-opens-discussion.ts"), "mine\n");

    await expect(
      initializeProject(
        directory,
        { recipes: "app/policies" },
        ["recipe/selection-opens-discussion"],
        noSelections,
      ),
    ).rejects.toThrow(
      "Retry the same catalog init command with: --file selection-opens-discussion-catalog.ts",
    );
  });

  test("does not suggest a recipe rename for a dependency collision", async () => {
    await initializeProject(directory, {}, [], noSelections);
    await mkdir(join(directory, "src/concepts/selecting"), { recursive: true });
    await writeFile(join(directory, "src/concepts/selecting/selecting.ts"), "mine\n");

    let message = "";
    try {
      await addEntries(directory, ["recipe/selection-opens-discussion"], noSelections);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("refusing to overwrite src/concepts/selecting/selecting.ts");
    expect(message).not.toContain("Retry with");
  });

  test("renames a recipe module and its paired evidence consistently", async () => {
    await initializeProject(directory, {}, [], noSelections);
    await addEntries(directory, ["recipe/selection-opens-discussion"], {
      variants: new Map(),
      recipeFile: "discussion-policy.ts",
    });
    await expect(
      readFile(join(directory, "src/composition/discussion-policy.ts"), "utf8"),
    ).resolves.toContain("SelectionOpensDiscussion");
    await expect(
      readFile(join(directory, "src/composition/discussion-policy.test.ts"), "utf8"),
    ).resolves.toContain('from "./discussion-policy.ts"');
  });

  test("does not rename tracked recipes or switch tracked concept variants", async () => {
    await initializeProject(
      directory,
      {},
      ["concept/gathering", "recipe/selection-opens-discussion"],
      { variants: new Map([["concept/gathering", "memory"]]) },
    );
    await expect(
      addEntries(directory, ["recipe/selection-opens-discussion"], {
        variants: new Map(),
        recipeFile: "renamed.ts",
      }),
    ).rejects.toThrow("cannot rename an already tracked recipe");
    await expect(
      addEntries(directory, ["concept/gathering"], {
        variants: new Map([["concept/gathering", "repository"]]),
      }),
    ).rejects.toThrow("already tracked with variant memory");
  });

  test("refuses to replace an edited managed integration module", async () => {
    await initializeProject(directory, {}, [], noSelections);
    const managed = join(directory, "src/catalog/composition.generated.ts");
    await writeFile(managed, `${await readFile(managed, "utf8")}\n// edited\n`);
    await expect(addEntries(directory, ["concept/selecting"], noSelections)).rejects.toThrow(
      "managed catalog file was edited",
    );
  });

  test("reports missing managed files and treats an explicit re-add as a no-op", async () => {
    await initializeProject(directory, {}, ["concept/selecting"], noSelections);
    const repeated = await addEntries(directory, ["concept/selecting"], noSelections);
    expect(repeated.written).toEqual([]);
    expect(repeated.alreadyInstalled).toEqual(["concept/selecting"]);

    await rm(join(directory, "src/catalog/composition.generated.ts"));
    await expect(addEntries(directory, ["concept/alerting"], noSelections)).rejects.toThrow(
      "managed catalog file is missing",
    );
  });

  test("rejects lock paths before they can affect generated imports", async () => {
    await initializeProject(directory, {}, ["concept/selecting"], noSelections);
    const lockPath = join(directory, "catalog.lock");
    const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
      entries: Record<string, { integration: { registration: string } }>;
    };
    lock.entries["concept/selecting"].integration.registration = "../../outside.ts";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    await expect(addEntries(directory, ["concept/alerting"], noSelections)).rejects.toThrow(
      "must be a project-relative portable path",
    );
  });

  test("diff reports local changes and forget retains copied source", async () => {
    await initializeProject(directory, {}, ["recipe/selection-opens-discussion"], noSelections);
    const recipe = join(directory, "src/composition/selection-opens-discussion.ts");
    await writeFile(recipe, `${await readFile(recipe, "utf8")}\n// local policy\n`);

    const difference = await diffEntries(directory, ["recipe/selection-opens-discussion"]);
    expect(difference.changed).toBe(1);
    expect(difference.output).toContain("local policy");

    await forgetEntries(directory, ["recipe/selection-opens-discussion"]);
    expect(await readFile(recipe, "utf8")).toContain("local policy");
    const composition = await readFile(
      join(directory, "src/catalog/composition.generated.ts"),
      "utf8",
    );
    expect(composition).not.toContain("selection-opens-discussion");
  });

  test("refuses to forget a dependency still used by a recipe", async () => {
    await initializeProject(directory, {}, ["recipe/selection-opens-discussion"], noSelections);
    await expect(forgetEntries(directory, ["concept/selecting"])).rejects.toThrow(
      "recipe/selection-opens-discussion still depends on concept/selecting",
    );
  });

  test("rejects unknown and repeated diff or forget operands", async () => {
    await initializeProject(directory, {}, ["concept/selecting"], noSelections);
    await expect(diffEntries(directory, ["concept/unknown"])).rejects.toThrow("is not tracked");
    await expect(
      diffEntries(directory, ["concept/selecting", "concept/selecting"]),
    ).rejects.toThrow("operands must be unique");
    await expect(forgetEntries(directory, ["concept/unknown"])).rejects.toThrow("is not tracked");
    await expect(
      forgetEntries(directory, ["concept/selecting", "concept/selecting"]),
    ).rejects.toThrow("operands must be unique");
    await expect(forgetEntries(directory, [])).rejects.toThrow("requires at least one entry");
  });
});

describe("catalog CLI", () => {
  test("lists and describes entries without an initialized project", async () => {
    const output: string[] = [];
    const io: CatalogIO = { log: (message) => output.push(message), error: () => undefined };
    await runCatalog(["list", "recipe"], directory, io);
    expect(output.join("\n")).toContain("recipe/member-contributions");
    output.length = 0;
    await runCatalog(["show", "bundle/operations-room"], directory, io);
    expect(output.join("\n")).toContain("incident-coordination application");
    output.length = 0;
    await runCatalog(["show", "concept/gathering"], directory, io);
    expect(output.join("\n")).toContain("repository: Application-supplied repository storage");
  });

  test("runs the complete metadata lifecycle through commands", async () => {
    const output: string[] = [];
    const io: CatalogIO = { log: (message) => output.push(message), error: () => undefined };
    await runCatalog(["--help"], directory, io);
    expect(output.join("\n")).toContain("Usage: catalog");
    output.length = 0;

    await runCatalog(["init"], directory, io);
    expect(output.join("\n")).toContain("Integrate once:");
    output.length = 0;

    await runCatalog(["add", "concept/selecting"], directory, io);
    expect(output.join("\n")).toContain("selecting.ts");
    output.length = 0;

    await runCatalog(["diff", "concept/selecting"], directory, io);
    expect(output).toEqual(["No catalog differences."]);
    output.length = 0;

    await runCatalog(["forget", "concept/selecting"], directory, io);
    expect(output.join("\n")).toContain("application-owned");
  });

  test.each([
    [["help", "extra"], "Usage: catalog"],
    [["list", "unknown"], "list kind"],
    [["list", "--bad"], "Usage: catalog"],
    [["show"], "Usage: catalog"],
    [["show", "unknown/entry"], "Unknown catalog entry"],
    [["init", "--bad"], "Unknown option"],
    [["init", "--concepts"], "needs a value"],
    [["init", "--concepts", "one", "--concepts", "two"], "may appear only once"],
    [["init", "--variant", "bad"], "requires concept/<id>=<variant>"],
    [
      ["init", "--variant", "concept/selecting=memory", "--variant", "concept/selecting=memory"],
      "--variant is repeated",
    ],
    [["init", "--file"], "--file needs a value"],
    [["init", "--file", "one.ts", "--file", "two.ts"], "--file may appear only once"],
    [["init", "--file", "one.ts"], "requires exactly one explicit recipe entry"],
    [["init", "--variant", "concept/selecting=memory"], "not used by this install"],
    [["add"], "requires at least one entry"],
    [["add", "concept/selecting", "--concepts", "somewhere"], "only valid with catalog init"],
    [["diff", "--bad"], "Usage: catalog"],
    [["forget"], "Usage: catalog"],
    [["unknown"], "Usage: catalog"],
  ] as const)("rejects invalid command %#", async (args, message) => {
    await expect(runCatalog([...args], directory)).rejects.toThrow(message);
  });
});
