import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { BootstrapOptions, BootstrapResult } from "../skills/sync-engine/scripts/bootstrap.ts";
import {
  capabilitySubsetIssue,
  run,
  type CommandDependencies,
} from "../skills/sync-engine/scripts/command.ts";
import { digestDesign, readLaunchRecord } from "../skills/sync-engine/scripts/records.ts";
import type { EffectiveCapabilityGrant } from "../skills/sync-engine/scripts/roles.ts";
import { parseLabeledOutput, promptContext, retainedContext } from "./test-support.ts";

const skillRoot = fileURLToPath(new URL("../skills/sync-engine", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("./fixtures/cli", import.meta.url));
const expectedRoot = fileURLToPath(new URL("./fixtures/expected", import.meta.url));
const temporary: string[] = [];
const instant = new Date("2026-08-19T09:06:43.000Z");

async function application(label: string): Promise<string> {
  const path = await realpath(await mkdtemp(resolve(tmpdir(), `sync-engine-skill-cli-${label}-`)));
  temporary.push(path);
  return path;
}

function bootstrapResult(
  root: string,
  outcome: BootstrapResult["outcome"] = "ready",
  warnings: readonly string[] = [],
): BootstrapResult {
  return {
    outcome,
    plan: {
      state: outcome === "choice-required" ? "version-conflict" : "ready",
      applicationRoot: root,
      commands: [],
      missingPackages: [],
      missingSetupFiles: [],
      ...(outcome === "choice-required"
        ? {
            conflict: {
              expected: "1.0.0",
              found: ["0.9.0"],
              canContinue: true,
              choices: ["align-pinned-release", "continue-with-warning", "stop-unchanged"],
            },
          }
        : {}),
    },
    commands: [],
    warnings,
    changedPaths: [],
  };
}

interface Invocation {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function invoke(
  args: readonly string[],
  cwd: string,
  dependencies: Omit<CommandDependencies, "cwd" | "skillRoot" | "stdout" | "stderr"> = {},
): Promise<Invocation> {
  let stdout = "";
  let stderr = "";
  const code = await run(args, {
    cwd,
    skillRoot,
    bootstrap: async ({ applicationRoot }) => bootstrapResult(applicationRoot),
    now: () => instant,
    ...dependencies,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

function reported(output: string, label: string): string {
  const values = parseLabeledOutput(output)[label];
  if (values?.length !== 1) throw new Error(`Expected one ${label} field`);
  return values[0]!;
}

function cliFailure(message: string, recovery?: string): Invocation {
  return {
    code: 1,
    stdout: "",
    stderr: `Error: ${message}\n${recovery === undefined ? "" : `Recovery: ${recovery}\n`}`,
  };
}

function inlineContext(displayName: string, content: string): string {
  return `**${displayName}**\n\n${content.trimEnd()}`;
}

async function copyFixture(root: string, name: string): Promise<string> {
  const target = resolve(root, "coordination", name);
  await mkdir(resolve(root, "coordination"), { recursive: true });
  await cp(resolve(fixtureRoot, name), target);
  return target;
}

async function started(root: string, slug = "message-board-search"): Promise<string> {
  const result = await invoke(["work", "start", slug], root);
  expect(result).toMatchObject({ code: 0, stderr: "" });
  return resolve(root, ".sync-engine/work", slug);
}

interface InitialLaunch {
  readonly recordPath: string;
  readonly responsePath: string;
  readonly promptPath: string;
  readonly briefPath: string;
  readonly taskPath: string;
  readonly grantPath: string;
  readonly output: string;
}

async function prepareInitial(
  root: string,
  options: {
    readonly grant?: "designer-grant.json" | "designer-narrow-grant.json";
    readonly designRoot?: string;
    readonly timeoutSeconds?: number;
  } = {},
): Promise<InitialLaunch> {
  const unit = resolve(root, ".sync-engine/work/message-board-search");
  const taskPath = await copyFixture(root, "initial-task.md");
  const grantPath = await copyFixture(root, options.grant ?? "designer-grant.json");
  const briefPath = resolve(unit, "brief.md");
  const result = await invoke(
    [
      "prompt",
      "build",
      "--work",
      "message-board-search",
      "--role",
      "designer",
      "--phase",
      "decomposition",
      "--task",
      taskPath,
      "--grant",
      grantPath,
      "--harness",
      "paseo",
      "--input",
      `brief=${briefPath}`,
      ...(options.designRoot === undefined ? [] : ["--design-root", options.designRoot]),
      ...(options.timeoutSeconds === undefined
        ? []
        : ["--timeout", String(options.timeoutSeconds)]),
    ],
    root,
  );
  expect(result).toMatchObject({ code: 0, stderr: "" });
  return {
    recordPath: reported(result.stdout, "Record"),
    responsePath: reported(result.stdout, "Response"),
    promptPath: reported(result.stdout, "Prompt"),
    briefPath,
    taskPath,
    grantPath,
    output: result.stdout,
  };
}

async function finalizeInitial(root: string, launch: InitialLaunch, response?: string) {
  const content =
    response ??
    "## Status\r\n\r\nComplete.\r\n\r\n## Changed\r\n\r\nNone.\r\n\r\n## Questions\r\n\r\nNone.\r\n";
  await writeFile(launch.responsePath, content, "utf8");
  const result = await invoke(
    ["launch", "complete", launch.recordPath, "--agent-id", "designer-agent-1", "--status", "Idle"],
    root,
  );
  return { result, content };
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("skill CLI help and arguments", () => {
  test("documents the complete small command surface", async () => {
    const root = await application("help");
    const expected = await readFile(resolve(expectedRoot, "help.txt"), "utf8");
    expect(await invoke([], root)).toEqual({ code: 0, stdout: expected, stderr: "" });
  });

  test.each([
    [["prompt", "build", "--unknown", "value"], "Unknown option for prompt build: --unknown"],
    [
      [
        "work",
        "start",
        "one",
        "--conflict",
        "align-pinned-release",
        "--conflict",
        "stop-unchanged",
      ],
      "Duplicate option for work start: --conflict",
    ],
    [
      ["work", "start", "one", "misplaced"],
      "Unexpected positional argument for work start: misplaced",
    ],
    [
      ["launch", "complete", "record.json", "extra"],
      "Unexpected positional argument for launch complete: extra",
    ],
  ])("rejects unknown, duplicate, and misplaced arguments", async (args, message) => {
    const root = await application("arguments");
    expect(await invoke(args, root)).toEqual(cliFailure(message));
  });
});

describe("work start", () => {
  test("bootstraps through injected dependencies before creating an unoverwritable brief", async () => {
    const root = await application("start");
    const calls: BootstrapOptions[] = [];
    const injectedBootstrap = {
      runCommand: async () => ({ exitCode: 0 }),
    };
    const first = await invoke(["work", "start", "durable-board"], root, {
      bootstrapDependencies: injectedBootstrap,
      bootstrap: async (options, dependencies) => {
        calls.push(options);
        expect(dependencies).toBe(injectedBootstrap);
        return bootstrapResult(options.applicationRoot, "continued-with-warning", [
          "Continuing with the usable installed release",
        ]);
      },
    });
    const unit = resolve(root, ".sync-engine/work/durable-board");
    const brief = resolve(unit, "brief.md");
    expect(first).toMatchObject({ code: 0, stderr: "" });
    expect(calls).toEqual([
      {
        applicationRoot: root,
        releaseManifestPath: resolve(skillRoot, "release.json"),
      },
    ]);
    expect(parseLabeledOutput(first.stdout)).toEqual({
      Warning: ["Continuing with the usable installed release"],
      Bootstrap: [`continued-with-warning; application ${root}`],
      "Work unit": [unit],
      Brief: [brief],
    });
    expect(await readFile(brief, "utf8")).toBe(
      await readFile(resolve(skillRoot, "prompts/brief.md"), "utf8"),
    );

    await writeFile(brief, "# User-edited brief\n", "utf8");
    let repeatedBootstrap = false;
    const repeated = await invoke(["work", "start", "durable-board"], root, {
      bootstrap: async ({ applicationRoot }) => {
        repeatedBootstrap = true;
        return bootstrapResult(applicationRoot);
      },
    });
    expect(repeated).toEqual(cliFailure("Work unit already exists: durable-board"));
    expect(repeatedBootstrap).toBe(false);
    expect(await readFile(brief, "utf8")).toBe("# User-edited brief\n");
  });

  test("rejects an invalid slug before bootstrap mutation", async () => {
    const root = await application("invalid-slug");
    let bootstrapped = false;
    const result = await invoke(["work", "start", "../escape"], root, {
      bootstrap: async ({ applicationRoot }) => {
        bootstrapped = true;
        return bootstrapResult(applicationRoot);
      },
    });
    expect(result).toEqual(cliFailure("Work slug must be 1-80 characters of lowercase kebab case"));
    expect(bootstrapped).toBe(false);
  });

  test("does not create work before an explicit conflict choice", async () => {
    const root = await application("conflict");
    const result = await invoke(["work", "start", "blocked"], root, {
      bootstrap: async ({ applicationRoot }) => bootstrapResult(applicationRoot, "choice-required"),
    });
    expect(result).toEqual(
      cliFailure(
        "Bootstrap requires an explicit framework conflict choice",
        "Rerun with --conflict <align-pinned-release|continue-with-warning|stop-unchanged>.",
      ),
    );
    await expect(readFile(resolve(root, ".sync-engine/work/blocked/brief.md"))).rejects.toThrow();
  });
});

describe("CLI input boundaries", () => {
  test("requires task and grant sources inside the application", async () => {
    const root = await application("task-grant-boundary");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const grant = await copyFixture(root, "designer-grant.json");
    const base = [
      "prompt",
      "build",
      "--work",
      "message-board-search",
      "--role",
      "designer",
      "--phase",
      "decomposition",
      "--harness",
      "paseo",
      "--input",
      `brief=${resolve(unit, "brief.md")}`,
    ];
    const taskSource = resolve(fixtureRoot, "initial-task.md");
    expect(await invoke([...base, "--task", taskSource, "--grant", grant], root)).toEqual(
      cliFailure(`Task escapes its allowed roots: ${taskSource} resolves to ${taskSource}`),
    );

    const grantSource = resolve(fixtureRoot, "designer-grant.json");
    expect(await invoke([...base, "--task", task, "--grant", grantSource], root)).toEqual(
      cliFailure(
        `Capability grant escapes its allowed roots: ${grantSource} resolves to ${grantSource}`,
      ),
    );
  });

  test("requires exact work brief and decomposition paths", async () => {
    const root = await application("work-input-boundary");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const grant = await copyFixture(root, "designer-grant.json");
    const wrongBrief = resolve(root, "brief.md");
    await writeFile(wrongBrief, "# Wrong brief\n", "utf8");
    for (const candidate of [wrongBrief, resolve(skillRoot, "prompts/brief.md")]) {
      const briefResult = await invoke(
        [
          "prompt",
          "build",
          "--work",
          "message-board-search",
          "--role",
          "designer",
          "--phase",
          "decomposition",
          "--task",
          task,
          "--grant",
          grant,
          "--harness",
          "paseo",
          "--input",
          `brief=${candidate}`,
        ],
        root,
      );
      expect(briefResult).toEqual(
        cliFailure(
          `Prompt input brief must be the exact work-unit path ${resolve(unit, "brief.md")}`,
        ),
      );
    }

    const contractsGrant = await copyFixture(root, "designer-contracts-grant.json");
    const wrongDecomposition = resolve(root, "decomposition.md");
    await writeFile(wrongDecomposition, "# Wrong decomposition\n", "utf8");
    for (const candidate of [wrongDecomposition, resolve(skillRoot, "prompts/brief.md")]) {
      const decompositionResult = await invoke(
        [
          "prompt",
          "build",
          "--work",
          "message-board-search",
          "--role",
          "designer",
          "--phase",
          "contracts",
          "--task",
          task,
          "--grant",
          contractsGrant,
          "--harness",
          "paseo",
          "--input",
          `brief=${resolve(unit, "brief.md")}`,
          "--input",
          `accepted-decomposition=${candidate}`,
        ],
        root,
      );
      expect(decompositionResult).toEqual(
        cliFailure(
          `Prompt input accepted-decomposition must be the exact work-unit path ${resolve(unit, "decomposition.md")}`,
        ),
      );
    }
  });

  test("rejects external inputs, symlink escapes, and noncanonical design roots", async () => {
    const root = await application("source-boundary");
    const unit = await started(root);
    const outside = await application("outside-source");
    const outsideInput = resolve(outside, "context.md");
    await writeFile(outsideInput, "# Outside context\n", "utf8");
    const linkedInput = resolve(root, "linked-context.md");
    await symlink(outsideInput, linkedInput);
    const task = await copyFixture(root, "initial-task.md");
    const grant = await copyFixture(root, "designer-grant.json");
    const base = [
      "prompt",
      "build",
      "--work",
      "message-board-search",
      "--role",
      "designer",
      "--phase",
      "decomposition",
      "--task",
      task,
      "--grant",
      grant,
      "--harness",
      "paseo",
      "--input",
      `brief=${resolve(unit, "brief.md")}`,
    ];
    for (const [path, canonical] of [
      [outsideInput, outsideInput],
      [linkedInput, outsideInput],
    ] as const) {
      expect(await invoke([...base, "--input", `affected-design=${path}`], root)).toEqual(
        cliFailure(
          `Prompt input affected-design escapes its allowed roots: ${path} resolves to ${canonical}`,
        ),
      );
    }

    const design = resolve(root, "design");
    const copied = resolve(root, "design-copy");
    await mkdir(design);
    await mkdir(copied);
    await writeFile(resolve(design, "types.md"), "# Types\n", "utf8");
    await writeFile(resolve(copied, "types.md"), "# Types\n", "utf8");
    expect(await invoke([...base, "--design-root", copied], root)).toEqual(
      cliFailure(`Design root must be the canonical application design path: ${design}`),
    );
  });
});

describe("prompt preparation and completion", () => {
  test("groups one timestamped artifact set and reports native adapter data", async () => {
    const root = await application("prepare");
    const unit = await started(root);
    const launch = await prepareInitial(root);
    const record = await readLaunchRecord(launch.recordPath);

    expect(record.state).toBe("prepared");
    expect(record).toMatchObject({
      work: { slug: "message-board-search", path: unit },
      role: "designer",
      phase: "decomposition",
      harness: "paseo",
      timeoutSeconds: 1800,
      response: { path: launch.responsePath },
      retainedSources: [
        { inputId: "brief", displayName: expect.any(String), sha256: expect.any(String) },
      ],
    });
    expect((await readdir(unit)).sort()).toHaveLength(6);
    expect(await readFile(launch.responsePath, "utf8")).toBe("");
    expect(await readFile((record as { prompt: { path: string } }).prompt.path, "utf8")).toBe(
      await readFile(launch.promptPath, "utf8"),
    );
    const prompt = await readFile(launch.promptPath, "utf8");
    expect(
      promptContext(prompt, ["Task", "Brief", "Current decomposition", "Affected existing design"]),
    ).toEqual({
      Task: inlineContext("coordination/initial-task.md", await readFile(launch.taskPath, "utf8")),
      Brief: inlineContext(
        ".sync-engine/work/message-board-search/brief.md",
        await readFile(launch.briefPath, "utf8"),
      ),
    });
    const preparedOutput = parseLabeledOutput(launch.output);
    expect({
      prepared: preparedOutput["Fresh launch prepared"],
      prompt: preparedOutput.Prompt,
      response: preparedOutput.Response,
      record: preparedOutput.Record,
      harness: preparedOutput.Harness,
      delivery: preparedOutput["Prompt delivery"],
      cwd: preparedOutput["Working directory"],
      timeout: preparedOutput.Timeout,
      sources: preparedOutput.Source,
      target: preparedOutput.Target,
      native: preparedOutput.Native,
      agentInstruction: preparedOutput["Agent instruction"],
      warning: preparedOutput.Warning,
    }).toEqual({
      prepared: ["designer/decomposition"],
      prompt: [launch.promptPath],
      response: [launch.responsePath],
      record: [launch.recordPath],
      harness: ["paseo"],
      delivery: ["agent-file-instruction; prompt"],
      cwd: [`${root}; explicit-application-cwd`],
      timeout: [
        "1800 seconds; coordinator-managed observation limit; CLI does not observe harness",
      ],
      sources: undefined,
      target: ["fresh agent"],
      native: ["Paseo native agent delegation; launch fresh agent"],
      agentInstruction: [
        `Read and follow the complete assignment in this prompt file:\n${launch.promptPath}`,
      ],
      warning: ["paseo capabilities are prompt-guided rather than harness-enforced."],
    });
    const stem = "2026-08-19T09-06-43Z-designer-decomposition";
    expect((await readdir(unit)).sort()).toEqual([
      `${stem}.capabilities.json`,
      `${stem}.prompt.md`,
      `${stem}.record.json`,
      `${stem}.response.md`,
      `${stem}.task.md`,
      "brief.md",
    ]);

    const configured = await prepareInitial(root, { timeoutSeconds: 42 });
    expect(await readLaunchRecord(configured.recordPath)).toMatchObject({ timeoutSeconds: 42 });
    expect(parseLabeledOutput(configured.output).Timeout).toEqual([
      "42 seconds; coordinator-managed observation limit; CLI does not observe harness",
    ]);
  });

  test("reads a verbatim native response, normalizes status, and finalizes", async () => {
    const root = await application("complete");
    await started(root);
    const launch = await prepareInitial(root);
    const { result, content } = await finalizeInitial(root, launch);
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseLabeledOutput(result.stdout)).toEqual({
      "Launch finalized": [launch.recordPath],
      Response: [launch.responsePath],
      Harness: ["paseo; agent designer-agent-1"],
      Status: ["completed"],
      Warning: ["paseo capabilities were prompt-guided rather than harness-enforced."],
    });
    expect(await readFile(launch.responsePath, "utf8")).toBe(content);
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "finalized",
      harness: "paseo",
      agentId: "designer-agent-1",
      status: "completed",
      enforcement: "prompt-guided",
    });
  });

  test("warns on malformed return headings but preserves and finalizes useful output", async () => {
    const root = await application("shape-warning");
    await started(root);
    const launch = await prepareInitial(root);
    const useful = "The work is complete; no files changed.\n";
    const { result } = await finalizeInitial(root, launch, useful);
    expect(result.code).toBe(0);
    expect(parseLabeledOutput(result.stdout)).toEqual({
      "Launch finalized": [launch.recordPath],
      Response: [launch.responsePath],
      Harness: ["paseo; agent designer-agent-1"],
      Status: ["completed"],
      Warning: [
        "paseo capabilities were prompt-guided rather than harness-enforced.",
        "native response is missing required headings: Status, Changed, Questions; the captured response was finalized unchanged.",
      ],
    });
    expect(await readFile(launch.responsePath, "utf8")).toBe(useful);
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("finalized");
  });

  test("rejects stale design for a nonwriter using the bound canonical root", async () => {
    const root = await application("stale-design");
    await started(root);
    const design = resolve(root, "design");
    await mkdir(design);
    await writeFile(resolve(design, "types.md"), "# Types\n", "utf8");
    const launch = await prepareInitial(root, { designRoot: design });
    const preparedRecord = await readLaunchRecord(launch.recordPath);
    expect({
      root: parseLabeledOutput(launch.output)["Design root"],
      before: parseLabeledOutput(launch.output)["Design before"],
    }).toEqual({
      root: [design],
      before: [preparedRecord.design?.before],
    });
    await writeFile(
      launch.responsePath,
      "## Status\nComplete\n## Changed\nNone\n## Questions\nNone\n",
      "utf8",
    );
    await writeFile(resolve(design, "types.md"), "# Changed types\n", "utf8");
    const result = await invoke(
      ["launch", "complete", launch.recordPath, "--agent-id", "agent", "--status", "completed"],
      root,
    );
    expect(result).toEqual(cliFailure("Design changed after preparation"));
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("prepared");
  });

  test("requires completed output but finalizes empty failure for explicit recovery", async () => {
    const root = await application("empty-response");
    await started(root);
    const launch = await prepareInitial(root);
    const completed = await invoke(
      ["launch", "complete", launch.recordPath, "--agent-id", "agent", "--status", "completed"],
      root,
    );
    expect(completed).toEqual(cliFailure(`Native response is empty: ${launch.responsePath}`));
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("prepared");

    const failed = await invoke(
      ["launch", "complete", launch.recordPath, "--agent-id", "agent", "--status", "failed"],
      root,
    );
    expect(failed.code).toBe(0);
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "finalized",
      status: "failed",
      response: { bytes: 0 },
    });

    const task = await copyFixture(root, "follow-up-task.md");
    const replacement = await invoke(
      [
        "continue",
        launch.recordPath,
        "--phase",
        "decomposition",
        "--task",
        task,
        "--grant",
        launch.grantPath,
        "--input",
        `brief=${launch.briefPath}`,
        "--replace",
        "--harness",
        "codex",
      ],
      root,
    );
    expect(replacement.code).toBe(0);
    expect(parseLabeledOutput(replacement.stdout)["Fresh-agent replacement prepared"]).toEqual([
      "designer/decomposition",
    ]);

    const invalidLaunch = await prepareInitial(root);
    await writeFile(invalidLaunch.responsePath, Uint8Array.from([0xc3, 0x28]));
    const invalid = await invoke(
      [
        "launch",
        "complete",
        invalidLaunch.recordPath,
        "--agent-id",
        "agent-2",
        "--status",
        "failed",
      ],
      root,
    );
    expect(invalid).toEqual(
      cliFailure(`Native response is not valid UTF-8: ${invalidLaunch.responsePath}`),
    );
    expect((await readLaunchRecord(invalidLaunch.recordPath)).state).toBe("prepared");
  });

  test("does not allow completion to switch the prepared harness", async () => {
    const root = await application("bound-harness");
    await started(root);
    const launch = await prepareInitial(root);
    await writeFile(
      launch.responsePath,
      "## Status\nComplete\n## Changed\nNone\n## Questions\nNone\n",
      "utf8",
    );
    const switched = await invoke(
      [
        "launch",
        "complete",
        launch.recordPath,
        "--agent-id",
        "agent",
        "--status",
        "completed",
        "--harness",
        "codex",
      ],
      root,
    );
    expect(switched).toEqual(cliFailure("Unknown option for launch complete: --harness"));
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "prepared",
      harness: "paseo",
    });
  });
});

describe("continuation and replacement", () => {
  test("keeps identity and harness with retained bindings, while replacement expands context", async () => {
    const root = await application("continuity");
    await started(root);
    const initial = await prepareInitial(root);
    expect((await finalizeInitial(root, initial)).result.code).toBe(0);
    const followUpTask = await copyFixture(root, "follow-up-task.md");
    const narrowGrant = await copyFixture(root, "designer-narrow-grant.json");

    const continuation = await invoke(
      [
        "continue",
        initial.recordPath,
        "--phase",
        "decomposition",
        "--task",
        followUpTask,
        "--grant",
        narrowGrant,
        "--input",
        `brief=${initial.briefPath}`,
        "--timeout",
        "75",
      ],
      root,
      { now: () => new Date("2026-08-19T09:10:00.000Z") },
    );
    expect(continuation).toMatchObject({ code: 0, stderr: "" });
    const continuationOutput = parseLabeledOutput(continuation.stdout);
    expect({
      prepared: continuationOutput["Same-agent continuation prepared"],
      harness: continuationOutput.Harness,
      targetAgent: continuationOutput["Target agent"],
      timeout: continuationOutput.Timeout,
    }).toEqual({
      prepared: ["designer/decomposition"],
      harness: ["paseo"],
      targetAgent: ["designer-agent-1"],
      timeout: ["75 seconds; coordinator-managed observation limit; CLI does not observe harness"],
    });
    const continuationPath = reported(continuation.stdout, "Record");
    const continuedRecord = await readLaunchRecord(continuationPath);
    expect(continuedRecord).toMatchObject({
      state: "prepared",
      harness: "paseo",
      timeoutSeconds: 75,
      relationship: { kind: "continuation", recordPath: initial.recordPath },
    });
    const continuedPrompt = await readFile(continuedRecord.prompt.path, "utf8");
    const retainedBrief = continuedRecord.retainedSources.find(
      ({ inputId }) => inputId === "brief",
    );
    if (retainedBrief === undefined) throw new Error("Prepared record omitted retained brief");
    expect(
      promptContext(continuedPrompt, [
        "Task",
        "Brief",
        "Current decomposition",
        "Affected existing design",
      ]),
    ).toEqual({
      Task: inlineContext("coordination/follow-up-task.md", await readFile(followUpTask, "utf8")),
      Brief: retainedContext(
        retainedBrief.displayName,
        retainedBrief.sha256,
        Buffer.byteLength(await readFile(initial.briefPath)),
      ),
    });

    const replacement = await invoke(
      [
        "continue",
        initial.recordPath,
        "--phase",
        "decomposition",
        "--task",
        followUpTask,
        "--grant",
        initial.grantPath,
        "--input",
        `brief=${initial.briefPath}`,
        "--replace",
        "--harness",
        "codex",
      ],
      root,
      { now: () => new Date("2026-08-19T09:11:00.000Z") },
    );
    expect(replacement).toMatchObject({ code: 0, stderr: "" });
    const replacementOutput = parseLabeledOutput(replacement.stdout);
    expect({
      prepared: replacementOutput["Fresh-agent replacement prepared"],
      harness: replacementOutput.Harness,
      target: replacementOutput.Target,
      targetAgent: replacementOutput["Target agent"],
    }).toEqual({
      prepared: ["designer/decomposition"],
      harness: ["codex"],
      target: ["fresh agent"],
      targetAgent: undefined,
    });
    const replacementRecord = await readLaunchRecord(reported(replacement.stdout, "Record"));
    expect(replacementRecord).toMatchObject({
      state: "prepared",
      harness: "codex",
      relationship: { kind: "replacement", recordPath: initial.recordPath },
    });
    const replacementPrompt = await readFile(replacementRecord.prompt.path, "utf8");
    expect(
      promptContext(replacementPrompt, [
        "Task",
        "Brief",
        "Current decomposition",
        "Affected existing design",
      ]),
    ).toEqual({
      Task: inlineContext("coordination/follow-up-task.md", await readFile(followUpTask, "utf8")),
      Brief: inlineContext(
        ".sync-engine/work/message-board-search/brief.md",
        await readFile(initial.briefPath, "utf8"),
      ),
    });
  });

  test("inlines unseen cross-phase context and lets the contract designer update design", async () => {
    const root = await application("designer-phase-transition");
    await started(root);
    const design = resolve(root, "design");
    await mkdir(resolve(design, "concepts"), { recursive: true });
    await writeFile(resolve(design, "types.md"), "# Types\n", "utf8");
    const initial = await prepareInitial(root, { designRoot: design });
    expect((await finalizeInitial(root, initial)).result.code).toBe(0);
    const task = await copyFixture(root, "follow-up-task.md");
    const grant = await copyFixture(root, "designer-contracts-grant.json");
    const decomposition = resolve(root, ".sync-engine/work/message-board-search/decomposition.md");
    const decompositionText = "# Accepted decomposition\n\nThe bounded map is accepted.\n";
    await writeFile(decomposition, decompositionText, "utf8");

    const transition = await invoke(
      [
        "continue",
        initial.recordPath,
        "--phase",
        "contracts",
        "--task",
        task,
        "--grant",
        grant,
        "--input",
        `brief=${initial.briefPath}`,
        "--input",
        `accepted-decomposition=${decomposition}`,
      ],
      root,
      { now: () => new Date("2026-08-19T09:12:00.000Z") },
    );
    expect(transition).toMatchObject({ code: 0, stderr: "" });
    const transitionOutput = parseLabeledOutput(transition.stdout);
    expect({
      prepared: transitionOutput["Same-agent continuation prepared"],
      targetAgent: transitionOutput["Target agent"],
    }).toEqual({
      prepared: ["designer/contracts"],
      targetAgent: ["designer-agent-1"],
    });
    const recordPath = reported(transition.stdout, "Record");
    const prepared = await readLaunchRecord(recordPath);
    expect(prepared).toMatchObject({
      state: "prepared",
      role: "designer",
      phase: "contracts",
      harness: "paseo",
      grant: {
        writableAreas: [{ area: "assigned-design", path: "concepts/Tasking.md" }],
        projectShell: "project-validation",
      },
      design: { root: design, before: expect.any(String) },
      relationship: { kind: "continuation", recordPath: initial.recordPath },
    });
    const prompt = await readFile(prepared.prompt.path, "utf8");
    const retainedBrief = prepared.retainedSources.find(({ inputId }) => inputId === "brief");
    if (retainedBrief === undefined) throw new Error("Prepared record omitted retained brief");
    expect(
      promptContext(prompt, [
        "Task",
        "Brief",
        "Accepted decomposition",
        "Resolved findings",
        "Affected contracts",
        "Catalog contracts",
        "Candidate contracts",
      ]),
    ).toEqual({
      Task: inlineContext("coordination/follow-up-task.md", await readFile(task, "utf8")),
      Brief: retainedContext(
        retainedBrief.displayName,
        retainedBrief.sha256,
        Buffer.byteLength(await readFile(initial.briefPath)),
      ),
      "Accepted decomposition": inlineContext(
        ".sync-engine/work/message-board-search/decomposition.md",
        decompositionText,
      ),
    });

    await writeFile(
      resolve(design, "concepts/Tasking.md"),
      "# Tasking\n\nThe contract designer changed permanent design.\n",
      "utf8",
    );
    await writeFile(
      prepared.response.path,
      "## Status\nComplete\n## Changed\ndesign/concepts/Tasking.md\n## Questions\nNone\n",
      "utf8",
    );
    const completion = await invoke(
      ["launch", "complete", recordPath, "--agent-id", "designer-agent-1", "--status", "completed"],
      root,
    );
    expect(completion.code).toBe(0);
    const finalized = await readLaunchRecord(recordPath);
    expect(finalized).toMatchObject({
      state: "finalized",
      harness: "paseo",
      agentId: "designer-agent-1",
      phase: "contracts",
      design: { root: design, before: expect.any(String), after: expect.any(String) },
    });
    expect(finalized.design?.after).not.toBe(finalized.design?.before);
  });

  test("refreshes a changed design digest for an implementation continuation", async () => {
    const root = await application("worker-design-refresh");
    const unit = await started(root);
    const design = resolve(root, "design");
    const specification = resolve(design, "concepts/Posting.md");
    await mkdir(resolve(design, "concepts"), { recursive: true });
    await writeFile(specification, "# Posting\n\nInitial approved contract.\n", "utf8");
    const reference = resolve(root, "public-reference.md");
    const startingPaths = resolve(root, "starting-paths.md");
    await writeFile(reference, "# Public reference\n\nUse the documented class API.\n", "utf8");
    await writeFile(startingPaths, "# Starting paths\n\n- src/concepts/Posting.ts\n", "utf8");
    const task = await copyFixture(root, "follow-up-task.md");
    const grant = await copyFixture(root, "concept-worker-grant.json");
    const brief = resolve(unit, "brief.md");
    const context = [
      "--input",
      `brief=${brief}`,
      "--input",
      `specifications=${specification}`,
      "--input",
      `public-references=${reference}`,
      "--input",
      `starting-paths=${startingPaths}`,
    ];
    const initial = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "concept-worker",
        "--phase",
        "implementation",
        "--task",
        task,
        "--grant",
        grant,
        "--harness",
        "paseo",
        ...context,
        "--design-root",
        design,
      ],
      root,
    );
    expect(initial.code).toBe(0);
    const initialPath = reported(initial.stdout, "Record");
    const initialRecord = await readLaunchRecord(initialPath);
    const oldDigest = initialRecord.design?.before;
    expect(oldDigest).toBe((await digestDesign(design)).digest);
    const response =
      "## Status\nComplete\n## Changed\nNone\n## Checks\nPassed\n## Blockers\nNone\n";
    await writeFile(initialRecord.response.path, response, "utf8");
    expect(
      (
        await invoke(
          [
            "launch",
            "complete",
            initialPath,
            "--agent-id",
            "concept-agent-1",
            "--status",
            "completed",
          ],
          root,
        )
      ).code,
    ).toBe(0);

    await writeFile(specification, "# Posting\n\nRevised approved contract.\n", "utf8");
    const continueArgs = [
      "continue",
      initialPath,
      "--phase",
      "implementation",
      "--task",
      task,
      "--grant",
      grant,
      ...context,
    ];
    const redundantRoot = await invoke([...continueArgs, "--design-root", design], root);
    expect(redundantRoot).toEqual(
      cliFailure("Continue already has a bound design root; omit --design-root"),
    );

    const continued = await invoke(continueArgs, root, {
      now: () => new Date("2026-08-19T09:13:00.000Z"),
    });
    expect(continued.code).toBe(0);
    const continuedPath = reported(continued.stdout, "Record");
    const continuedRecord = await readLaunchRecord(continuedPath);
    const revisedDigest = (await digestDesign(design)).digest;
    expect(continuedRecord.design?.before).toBe(revisedDigest);
    expect(continuedRecord.design?.before).not.toBe(oldDigest);
    const continuedPrompt = await readFile(continuedRecord.prompt.path, "utf8");
    const retainedBrief = continuedRecord.retainedSources.find(
      ({ inputId }) => inputId === "brief",
    );
    const retainedReference = continuedRecord.retainedSources.find(
      ({ inputId }) => inputId === "public-references",
    );
    if (retainedBrief === undefined || retainedReference === undefined) {
      throw new Error("Prepared record omitted retained worker context");
    }
    expect(
      promptContext(continuedPrompt, [
        "Task",
        "Brief",
        "Concept specifications",
        "Public framework references",
        "Examples",
        "Exact starting paths",
      ]),
    ).toEqual({
      Task: inlineContext("coordination/follow-up-task.md", await readFile(task, "utf8")),
      Brief: retainedContext(
        retainedBrief.displayName,
        retainedBrief.sha256,
        Buffer.byteLength(await readFile(brief)),
      ),
      "Concept specifications": inlineContext(
        "design/concepts/Posting.md",
        await readFile(specification, "utf8"),
      ),
      "Public framework references": retainedContext(
        retainedReference.displayName,
        retainedReference.sha256,
        Buffer.byteLength(await readFile(reference)),
      ),
      "Exact starting paths": inlineContext(
        "starting-paths.md",
        await readFile(startingPaths, "utf8"),
      ),
    });

    await writeFile(specification, "# Posting\n\nChanged again after preparation.\n", "utf8");
    await writeFile(continuedRecord.response.path, response, "utf8");
    const staleCompletion = await invoke(
      [
        "launch",
        "complete",
        continuedPath,
        "--agent-id",
        "concept-agent-1",
        "--status",
        "completed",
      ],
      root,
    );
    expect(staleCompletion).toEqual(cliFailure("Design changed after preparation"));

    const refreshed = await invoke(continueArgs, root, {
      now: () => new Date("2026-08-19T09:14:00.000Z"),
    });
    expect(refreshed.code).toBe(0);
    const refreshedPath = reported(refreshed.stdout, "Record");
    const refreshedRecord = await readLaunchRecord(refreshedPath);
    const currentDigest = (await digestDesign(design)).digest;
    expect(refreshedRecord.design?.before).toBe(currentDigest);
    await writeFile(refreshedRecord.response.path, response, "utf8");
    const completed = await invoke(
      [
        "launch",
        "complete",
        refreshedPath,
        "--agent-id",
        "concept-agent-1",
        "--status",
        "completed",
      ],
      root,
    );
    expect(completed.code).toBe(0);
    expect(await readLaunchRecord(refreshedPath)).toMatchObject({
      state: "finalized",
      design: { root: design, before: currentDigest },
      harness: "paseo",
      agentId: "concept-agent-1",
    });
  });

  test("rejects a capability expansion and a harness change for same-agent continuation", async () => {
    const root = await application("continuation-integrity");
    await started(root);
    const initial = await prepareInitial(root, { grant: "designer-narrow-grant.json" });
    expect((await finalizeInitial(root, initial)).result.code).toBe(0);
    const followUpTask = await copyFixture(root, "follow-up-task.md");
    const fullGrant = await copyFixture(root, "designer-grant.json");

    const expanded = await invoke(
      [
        "continue",
        initial.recordPath,
        "--phase",
        "decomposition",
        "--task",
        followUpTask,
        "--grant",
        fullGrant,
        "--input",
        `brief=${initial.briefPath}`,
      ],
      root,
    );
    expect(expanded).toEqual(
      cliFailure("Continuation capability grant readableAreas expands at design:."),
    );

    const changedHarness = await invoke(
      [
        "continue",
        initial.recordPath,
        "--phase",
        "decomposition",
        "--task",
        followUpTask,
        "--grant",
        initial.grantPath,
        "--input",
        `brief=${initial.briefPath}`,
        "--harness",
        "codex",
      ],
      root,
    );
    expect(changedHarness).toEqual(cliFailure("--harness is valid only with --replace"));
  });

  test("recognizes a child path as a narrowed capability", () => {
    const base: EffectiveCapabilityGrant = {
      readableAreas: [{ area: "application", path: "src" }],
      writableAreas: [],
      toolKinds: ["repository-read"],
      projectShell: "none",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    };
    expect(
      capabilitySubsetIssue(
        { ...base, readableAreas: [{ area: "application", path: "src/features" }] },
        base,
      ),
    ).toBeUndefined();
  });
});
