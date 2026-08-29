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

function jsonModes(args: readonly string[]): {
  readonly text: ReturnType<typeof run>;
  readonly json: JsonDocument;
} {
  const text = run(args);
  const result = run([...args, "--format", "json"]);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(text.status);
  expect(result.stderr).toBe("");

  const json = JSON.parse(result.stdout) as JsonDocument;
  // The canonical reserialization proves stdout contained only this one JSON document.
  expect(result.stdout).toBe(`${JSON.stringify(json)}\n`);
  return { text, json };
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
    const passing = jsonModes(["check", "--config", readingCircle]);
    expect(passing.text.status).toBe(0);
    expect(passing.json).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check",
      status: "passed",
    });
    expect(passing.json.diagnostics).toContainEqual(
      expect.objectContaining({ code: "MISSING_ENDPOINT_FALLBACK", severity: "warning" }),
    );
    expect(passing.text.stdout).not.toContain("warning MISSING_ENDPOINT_FALLBACK");
    expect(passing.text.stdout).toContain("use --show-advisories to list them");

    const expanded = run(["check", "--config", readingCircle, "--show-advisories"]);
    expect(expanded.status).toBe(0);
    expect(expanded.stdout).toContain("warning MISSING_ENDPOINT_FALLBACK");
    expect(expanded.stdout).toContain("info ORDER_SENSITIVE_FORMER");

    const failing = jsonModes(["check", "--config", readingCircle, "--fail-on-warnings"]);
    expect(failing.text.status).toBe(1);
    expect(failing.json).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check",
      status: "failed",
    });
    expect(failing.json.diagnostics).toContainEqual(
      expect.objectContaining({ code: "MISSING_ENDPOINT_FALLBACK", severity: "warning" }),
    );
    expect(failing.text.stdout).toContain("warning MISSING_ENDPOINT_FALLBACK");
  }, 60_000);

  test("check-design emits located SSF records and preserves pass/fail exit codes", () => {
    const passing = jsonModes([
      "check-design",
      "examples/reading-circle/design/types.md",
      "examples/reading-circle/design/compositions/ReadingCircle.md",
    ]);
    expect(passing.text.status).toBe(0);
    expect(passing.json).toEqual({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check-design",
      status: "passed",
      diagnostics: [],
    });

    const failing = jsonModes(["check-design", invalidStatePath]);
    expect(failing.text.status).toBe(1);
    expect(failing.json).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "check-design",
      status: "failed",
    });
    expect(failing.json.diagnostics).toEqual([
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
        code: "SSF_MISPLACED_MODIFIER",
        severity: "error",
        path: documentLabel(invalidStatePath, invalidStatePath),
        line: 22,
        column: 17,
        suggestion: "  a optional discardedAt DateTime",
      }),
    ]);
  }, 30_000);

  test("artifacts check emits a JSON-only result and preserves pass/fail exit codes", () => {
    const passing = jsonModes(["artifacts", "check", "--config", readingCircle]);
    expect(passing.text.status).toBe(0);
    expect(passing.json).toEqual({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "artifacts check",
      status: "passed",
      diagnostics: [],
    });

    const failing = jsonModes(["artifacts", "check", "--config", packaging]);
    expect(failing.text.status).toBe(1);
    expect(failing.json).toMatchObject({
      format: "sync-engine.diagnostic-report",
      version: 1,
      command: "artifacts check",
      status: "failed",
    });
    expect(failing.json.diagnostics).toEqual([
      expect.objectContaining({ code: "ARTIFACT_CHECK_FAILURE", severity: "error" }),
    ]);
  }, 60_000);

  test("verify serializes its report directly and preserves pass/fail exit codes", () => {
    const passing = jsonModes(["verify", "--config", readingCircle]);
    expect(passing.text.status).toBe(0);
    expect(passing.json).toMatchObject({
      format: "sync-engine.verification-report",
      version: 1,
      status: "passed",
      steps: [
        { name: "check-design", status: "passed" },
        { name: "check", status: "passed" },
        { name: "artifacts check", status: "passed" },
      ],
    });
    expect(passing.json.config).toBe(readingCircle);
    expect(passing.json.configuration).toEqual(
      expect.objectContaining({
        status: "loaded",
        documents: [
          join(root, "examples/reading-circle/design/types.md"),
          join(root, "examples/reading-circle/design/compositions/ReadingCircle.md"),
        ],
      }),
    );

    const config = relative(root, brokenVerificationConfig);
    const failing = jsonModes(["verify", "--config", config]);
    expect(failing.text.status).toBe(1);
    expect(failing.json).toMatchObject({
      format: "sync-engine.verification-report",
      version: 1,
      status: "failed",
      steps: [
        expect.objectContaining({ name: "check-design", status: "failed" }),
        expect.objectContaining({ name: "check", status: "failed" }),
        expect.objectContaining({ name: "artifacts check", status: "failed" }),
      ],
    });
    expect(failing.json.config).toBe(config);
    expect(failing.json.configuration).toEqual(
      expect.objectContaining({
        status: "loaded",
        documents: [join(temporary, "design.md")],
      }),
    );
    expect(failing.json.steps?.[0]?.detail).toContain("exact non-wildcard");
  }, 120_000);

  test("verify serializes a failed configuration report and skips every check", () => {
    const config = relative(root, unloadableVerificationConfig);
    const failedConfiguration = jsonModes(["verify", "--config", config]);
    expect(failedConfiguration.text.status).toBe(1);
    expect(failedConfiguration.json).toMatchObject({
      format: "sync-engine.verification-report",
      version: 1,
      status: "failed",
    });
    expect(failedConfiguration.json.config).toBe(config);
    expect(failedConfiguration.json.configuration).toEqual(
      expect.objectContaining({
        status: "failed",
        documents: [],
        detail: expect.stringMatching(/\S/),
      }),
    );
    expect(failedConfiguration.json.steps).toEqual([
      expect.objectContaining({ name: "check-design", status: "skipped" }),
      expect.objectContaining({ name: "check", status: "skipped" }),
      expect.objectContaining({ name: "artifacts check", status: "skipped" }),
    ]);
  }, 30_000);
});
