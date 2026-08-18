import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCommand } from "@command/verify";
import { describe, expect, test, vi } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const main = join(root, "src/command/main.ts");

function run(...args: string[]) {
  return spawnSync("bun", [main, ...args], { cwd: root, encoding: "utf8" });
}

async function temporaryProject(): Promise<string> {
  return mkdtemp(join(root, "tests/.sync-engine-discovery-"));
}

async function inDirectory<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(directory);
  try {
    return await operation();
  } finally {
    process.chdir(previous);
  }
}

async function withoutOutput<T>(operation: () => Promise<T>): Promise<T> {
  const output = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    return await operation();
  } finally {
    output.mockRestore();
  }
}

async function writeBrokenDesignProject(directory: string): Promise<string> {
  const config = join(directory, "generated.config.ts");
  await writeFile(
    config,
    'import { assembleReadingCircle } from "../../examples/reading-circle/src/assembly.ts";\n\n' +
      "export default {\n" +
      "  assemble: assembleReadingCircle,\n" +
      '  title: "Broken verification fixture",\n' +
      "  conceptSet: {\n" +
      '    module: new URL("../../examples/reading-circle/src/concepts.ts", import.meta.url),\n' +
      "  },\n" +
      "  design: {\n" +
      "    version: 1,\n" +
      '    documents: [new URL("./design.md", import.meta.url)],\n' +
      "  },\n" +
      "};\n",
  );
  await writeFile(
    join(directory, "design.md"),
    "# Broken verification fixture\n\n[broken](reaction:ReadingCircle.*)\n",
  );
  return relative(root, config);
}

async function writeConceptFreeProject(directory: string): Promise<string> {
  const config = join(directory, "generated.config.ts");
  await writeFile(
    join(directory, "concepts.ts"),
    'import { conceptSet } from "@mit-sdg/sync-engine/assembly";\n\n' +
      "export const applicationConceptSet = conceptSet({});\n",
  );
  await writeFile(
    config,
    'import { assemble } from "@mit-sdg/sync-engine/assembly";\n' +
      'import { applicationConceptSet } from "./concepts.ts";\n\n' +
      "export default {\n" +
      "  assemble: () =>\n" +
      "    assemble({\n" +
      "      conceptSet: applicationConceptSet,\n" +
      "      instances: applicationConceptSet.implementations(),\n" +
      "      composition: {},\n" +
      "    }),\n" +
      '  title: "Concept-free verification fixture",\n' +
      '  conceptSet: { module: new URL("./concepts.ts", import.meta.url) },\n' +
      "  design: { version: 1, documents: [] },\n" +
      "};\n",
  );
  return relative(root, config);
}

async function writeSourceFailureProject(directory: string): Promise<string> {
  const config = join(directory, "generated.config.ts");
  await writeFile(
    config,
    'import { assembleReadingCircle } from "../../examples/reading-circle/src/assembly.ts";\n\n' +
      "export default {\n" +
      "  assemble: assembleReadingCircle,\n" +
      '  title: "Source failure fixture",\n' +
      '  conceptSet: { module: new URL("./concepts.ts", import.meta.url) },\n' +
      "  design: {\n" +
      "    version: 1,\n" +
      "    documents: [\n" +
      '      new URL("../../examples/reading-circle/design/types.md", import.meta.url),\n' +
      '      new URL("../../examples/reading-circle/design/compositions/ReadingCircle.md", import.meta.url),\n' +
      "    ],\n" +
      "  },\n" +
      "};\n",
  );
  await writeFile(
    join(directory, "concepts.ts"),
    'import { conceptSet, registerConcept } from "@mit-sdg/sync-engine/assembly";\n' +
      'import gatheringSpec from "../../examples/reading-circle/design/concepts/Gathering.md" with { type: "text" };\n' +
      'import selectingSpec from "../../examples/reading-circle/design/concepts/Selecting.md" with { type: "text" };\n' +
      'import discussingSpec from "../../examples/reading-circle/design/concepts/Discussing.md" with { type: "text" };\n\n' +
      "class GatheringConcept {\n" +
      "  create({ name }: { name: string }) {\n" +
      "    return { gathering: name };\n" +
      "  }\n" +
      "}\n" +
      "class SelectingConcept {}\n" +
      "class DiscussingConcept {}\n\n" +
      "const Gathering = registerConcept({ class: GatheringConcept, spec: gatheringSpec });\n" +
      "const Selecting = registerConcept({ class: SelectingConcept, spec: selectingSpec });\n" +
      "const Discussing = registerConcept({ class: DiscussingConcept, spec: discussingSpec });\n" +
      "export const applicationConceptSet = conceptSet({ Gathering, Selecting, Discussing });\n",
  );
  return relative(root, config);
}

describe("sync-engine verify", () => {
  test("reports every configured check for an all-passing project", async () => {
    const verified = run("verify", "--config", "examples/reading-circle/generated.config.ts");

    expect({ status: verified.status, stderr: verified.stderr }).toEqual({ status: 0, stderr: "" });
    expect(verified.stdout).toContain(
      "Verification report for examples/reading-circle/generated.config.ts",
    );
    expect(verified.stdout).toMatch(
      /configured design documents: 2\n  check-design: passed\n  check: passed\n  artifacts check: passed\nVerification passed\./,
    );

    const report = await withoutOutput(() =>
      inDirectory(root, () =>
        verifyCommand(["--config", "examples/reading-circle/generated.config.ts"]),
      ),
    );
    expect(report).toMatchObject({
      status: "passed",
      configuration: { status: "loaded", documents: expect.any(Array) },
      steps: [
        { name: "check-design", status: "passed" },
        { name: "check", status: "passed" },
        { name: "artifacts check", status: "passed" },
      ],
    });
  }, 30_000);

  test("reports a first-step design failure", async () => {
    const directory = await temporaryProject();
    try {
      const config = await writeBrokenDesignProject(directory);
      const verified = run("verify", "--config", config);

      expect({ status: verified.status, stderr: verified.stderr }).toEqual({
        status: 1,
        stderr: "",
      });
      expect(verified.stdout).toMatch(
        /check-design: failed\n    Design document .*exact non-wildcard/s,
      );
      expect(verified.stdout).toMatch(/check: failed\n    .*exact non-wildcard/s);
      expect(verified.stdout).toMatch(/artifacts check: failed\n    .*exact non-wildcard/s);
      expect(verified.stdout).toContain("Verification failed.");

      const report = await withoutOutput(() =>
        inDirectory(root, () => verifyCommand(["--config", config])),
      );
      expect(report.steps.map(({ status }) => status)).toEqual(["failed", "failed", "failed"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  test("continues to artifact verification after an application check failure", async () => {
    const directory = await temporaryProject();
    try {
      const config = await writeSourceFailureProject(directory);
      const pinned = run("artifacts", "pin", "--config", config);
      expect({ status: pinned.status, stderr: pinned.stderr }).toEqual({ status: 0, stderr: "" });

      const verified = run("verify", "--config", config);
      expect({ status: verified.status, stderr: verified.stderr }).toEqual({
        status: 1,
        stderr: "",
      });
      expect(verified.stdout).toContain("check-design: passed");
      expect(verified.stdout).toContain("check: failed");
      expect(verified.stdout).toContain(
        "the action `create` declares the inputs `name`, `host` but the class takes `name`",
      );
      expect(verified.stdout).toContain("artifacts check: passed");
      expect(verified.stdout).toContain("Verification failed.");

      const report = await withoutOutput(() =>
        inDirectory(root, () => verifyCommand(["--config", config])),
      );
      expect(report.steps.map(({ status }) => status)).toEqual(["passed", "failed", "passed"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  test("skips the explicit design command for a valid empty registration", async () => {
    const directory = await temporaryProject();
    try {
      const config = await writeConceptFreeProject(directory);
      const pinned = run("artifacts", "pin", "--config", config);
      expect({ status: pinned.status, stderr: pinned.stderr }).toEqual({ status: 0, stderr: "" });

      const report = await withoutOutput(() =>
        inDirectory(root, () => verifyCommand(["--config", config])),
      );
      expect(report).toMatchObject({
        status: "passed",
        steps: [
          {
            name: "check-design",
            status: "skipped",
            detail: "no design documents are registered in the configuration",
          },
          { name: "check", status: "passed" },
          { name: "artifacts check", status: "passed" },
        ],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  test("reports configuration discovery failure without attempting a check", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sync-engine-verify-missing-"));
    try {
      const report = await withoutOutput(() => inDirectory(directory, () => verifyCommand([])));
      expect(report).toMatchObject({
        status: "failed",
        configuration: { status: "failed", documents: [] },
        steps: [
          { name: "check-design", status: "skipped" },
          { name: "check", status: "skipped" },
          { name: "artifacts check", status: "skipped" },
        ],
      });
      expect(report.configuration.detail).toContain("generated.config.ts");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
