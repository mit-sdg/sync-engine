import { spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const main = join(root, "src/command/main.ts");
const readingCircle = "examples/reading-circle/generated.config.ts";
const packaging = "tests/packaging/application/generated.config.ts";
let temporary = "";
let brokenVerificationConfig = "";
let unloadableVerificationConfig = "";
let invalidStatePath = "";

interface JsonDocument {
  readonly format: string;
  readonly version: number;
  readonly status: string;
  readonly config?: string;
  readonly configuration?: {
    readonly status: "loaded" | "failed";
    readonly documents: readonly string[];
    readonly detail?: string;
  };
  readonly diagnostics?: readonly {
    readonly code: string;
    readonly severity: string;
    readonly path?: string;
    readonly line?: number;
    readonly column?: number;
    readonly suggestion?: string;
  }[];
  readonly steps?: readonly {
    readonly name: string;
    readonly status: string;
    readonly detail?: string;
  }[];
}

function documentLabel(absolute: string, supplied: string): string {
  return (relative(root, absolute) || supplied).split(sep).join("/");
}

function run(args: readonly string[]) {
  return spawnSync("bun", [main, ...args], { cwd: root, encoding: "utf8" });
}

// Each spawn re-runs the command's full TypeScript analysis, so pinning the exit code the caller
// already knows costs half as much as running the command a second time without --format json to
// compare against. Text mode keeps its own exit-code coverage in the check-specs, manifest, and
// verify tests.
function jsonMode(args: readonly string[], status: number): JsonDocument {
  const result = run([...args, "--format", "json"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(status);
  expect(result.stderr).toBe("");

  const json = JSON.parse(result.stdout) as JsonDocument;
  // The canonical reserialization proves stdout contained only this one JSON document.
  expect(result.stdout).toBe(`${JSON.stringify(json)}\n`);
  return json;
}

const invalidState = `# Noting

## Purpose

Keep a note for later retrieval.

## Principle

A person writes a note and reads it back by its identity.

## Types

\`\`\`types
external Person
  The note author.
\`\`\`

## State

\`\`\`state
a sequence of Notes
  a discardedAt optional DateTime
\`\`\`

## Actions

\`\`\`actions
write (author: Person, text: String) : return (note: Note)
  where true
  then
    add a Note
    return note
\`\`\`

## Queries

\`\`\`queries
_note (note: Note) : optional (author: Person, text: String)
\`\`\`
`;

beforeAll(async () => {
  temporary = await realpath(await mkdtemp(join(tmpdir(), "sync-engine-json-output-")));
  invalidStatePath = join(temporary, "invalid-state.md");
  brokenVerificationConfig = join(temporary, "generated.config.ts");
  unloadableVerificationConfig = join(temporary, "unloadable.config.ts");
  await writeFile(invalidStatePath, invalidState);
  await writeFile(unloadableVerificationConfig, 'throw new Error("fixture cannot load");\n');
  await writeFile(join(temporary, "design.md"), "# Broken\n\n[broken](reaction:ReadingCircle.*)\n");
  await writeFile(
    brokenVerificationConfig,
    'import { assembleReadingCircle } from "' +
      `${pathToFileURL(join(root, "examples/reading-circle/src/assembly.ts")).href}` +
      '";\n\n' +
      "export default {\n" +
      "  assemble: assembleReadingCircle,\n" +
      '  title: "Broken JSON verification fixture",\n' +
      "  conceptSet: {\n" +
      '    module: new URL("' +
      `${pathToFileURL(join(root, "examples/reading-circle/src/concepts.ts")).href}` +
      '", import.meta.url),\n' +
      "  },\n" +
      '  design: { version: 1, documents: [new URL("./design.md", import.meta.url)] },\n' +
      "};\n",
  );
});

afterAll(async () => {
  await rm(temporary, { recursive: true, force: true });
});

describe("versioned JSON validation output", () => {
  test("check emits application diagnostics and preserves pass/fail exit codes", () => {
    const passing = jsonMode(["check", "--config", readingCircle], 0);
    expect(passing).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check",
      status: "passed",
    });
    expect(passing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "MISSING_ENDPOINT_FALLBACK", severity: "warning" }),
    );

    const failing = jsonMode(["check", "--config", readingCircle, "--fail-on-warnings"], 1);
    expect(failing).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check",
      status: "failed",
    });
    expect(failing.diagnostics).toContainEqual(
      expect.objectContaining({ code: "MISSING_ENDPOINT_FALLBACK", severity: "warning" }),
    );
  }, 60_000);

  test("check-design emits located SSF records and preserves pass/fail exit codes", () => {
    const passing = jsonMode(
      [
        "check-design",
        "examples/reading-circle/design/types.md",
        "examples/reading-circle/design/compositions/ReadingCircle.md",
      ],
      0,
    );
    expect(passing).toEqual({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check-design",
      status: "passed",
      diagnostics: [],
    });

    const failing = jsonMode(["check-design", invalidStatePath], 1);
    expect(failing).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check-design",
      status: "failed",
    });
    expect(failing.diagnostics).toEqual([
      expect.objectContaining({
        code: "SSF_NEAR_MISS_KEYWORD",
        severity: "error",
        path: documentLabel(invalidStatePath, invalidStatePath),
        line: 21,
        column: 3,
        suggestion: "a seq of Notes with",
      }),
      expect.objectContaining({
        code: "SSF_MISSING_WITH",
        severity: "error",
        path: documentLabel(invalidStatePath, invalidStatePath),
        line: 21,
        column: 20,
        suggestion: "a seq of Notes with",
      }),
      expect.objectContaining({
        code: "SSF_MISPLACED_OPTIONAL",
        severity: "error",
        path: documentLabel(invalidStatePath, invalidStatePath),
        line: 22,
        column: 17,
        suggestion: "  an optional discardedAt DateTime",
      }),
    ]);
  }, 30_000);

  test("artifacts check emits a JSON-only result and preserves pass/fail exit codes", () => {
    const passing = jsonMode(["artifacts", "check", "--config", readingCircle], 0);
    expect(passing).toEqual({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "artifacts check",
      status: "passed",
      diagnostics: [],
    });

    const failing = jsonMode(["artifacts", "check", "--config", packaging], 1);
    expect(failing).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "artifacts check",
      status: "failed",
    });
    expect(failing.diagnostics).toEqual([
      expect.objectContaining({ code: "ARTIFACT_CHECK_FAILURE", severity: "error" }),
    ]);
  }, 60_000);

  test("verify serializes its report directly and preserves pass/fail exit codes", () => {
    const passing = jsonMode(["verify", "--config", readingCircle], 0);
    expect(passing).toMatchObject({
      format: "sync-engine.verification-report",
      version: 1,
      status: "passed",
      steps: [
        { name: "check-design", status: "passed" },
        { name: "check", status: "passed" },
        { name: "artifacts check", status: "passed" },
      ],
    });
    expect(passing.config).toBe(readingCircle);
    expect(passing.configuration).toEqual(
      expect.objectContaining({
        status: "loaded",
        documents: [
          join(root, "examples/reading-circle/design/types.md"),
          join(root, "examples/reading-circle/design/compositions/ReadingCircle.md"),
        ],
      }),
    );

    const config = relative(root, brokenVerificationConfig);
    const failing = jsonMode(["verify", "--config", config], 1);
    expect(failing).toMatchObject({
      format: "sync-engine.verification-report",
      version: 1,
      status: "failed",
      steps: [
        expect.objectContaining({ name: "check-design", status: "failed" }),
        expect.objectContaining({ name: "check", status: "failed" }),
        expect.objectContaining({ name: "artifacts check", status: "failed" }),
      ],
    });
    expect(failing.config).toBe(config);
    expect(failing.configuration).toEqual(
      expect.objectContaining({
        status: "loaded",
        documents: [join(temporary, "design.md")],
      }),
    );
    expect(failing.steps?.[0]?.detail).toContain("exact non-wildcard");
  }, 120_000);

  test("verify serializes a failed configuration report and skips every check", () => {
    const config = relative(root, unloadableVerificationConfig);
    const failedConfiguration = jsonMode(["verify", "--config", config], 1);
    expect(failedConfiguration).toMatchObject({
      format: "sync-engine.verification-report",
      version: 1,
      status: "failed",
    });
    expect(failedConfiguration.config).toBe(config);
    expect(failedConfiguration.configuration).toEqual(
      expect.objectContaining({
        status: "failed",
        documents: [],
        detail: expect.stringMatching(/\S/),
      }),
    );
    expect(failedConfiguration.steps).toEqual([
      expect.objectContaining({ name: "check-design", status: "skipped" }),
      expect.objectContaining({ name: "check", status: "skipped" }),
      expect.objectContaining({ name: "artifacts check", status: "skipped" }),
    ]);
  }, 30_000);
});
