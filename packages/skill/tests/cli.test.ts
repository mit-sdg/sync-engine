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
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vite-plus/test";
import type { BootstrapOptions, BootstrapResult } from "../skills/sync-engine/scripts/bootstrap.ts";
import {
  defaultSkillRootForCommand,
  run,
  type CommandDependencies,
} from "../skills/sync-engine/scripts/command.ts";
import {
  digestDesign,
  finalizeSimulation,
  prepareLaunch,
  readLaunchRecord,
} from "../skills/sync-engine/scripts/records.ts";
import { parseLabeledOutput, promptContext, retainedContext } from "./test-support.ts";

const skillRoot = fileURLToPath(new URL("../skills/sync-engine", import.meta.url));
const fixtureRoot = fileURLToPath(new URL("./fixtures/cli", import.meta.url));
const expectedRoot = fileURLToPath(new URL("./fixtures/expected", import.meta.url));
const temporary: string[] = [];
const instant = new Date("2026-08-19T09:06:43.000Z");
const paseoAgentId = "11111111-1111-4111-8111-111111111111";
const secondPaseoAgentId = "22222222-2222-4222-8222-222222222222";

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

function fakePaseo(
  replies: Array<{ readonly exitCode?: number; readonly output: string }>,
  calls: Array<{ readonly args: readonly string[]; readonly cwd: string }>,
): NonNullable<CommandDependencies["paseoCommand"]> {
  return async (args, cwd) => {
    calls.push({ args, cwd });
    const reply = replies.shift();
    if (reply === undefined) throw new Error(`Unexpected Paseo call: ${args.join(" ")}`);
    return { exitCode: reply.exitCode ?? 0, output: reply.output };
  };
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

async function started(
  root: string,
  slug = "message-board-search",
  policy?: {
    readonly review?: "required" | "omitted";
    readonly execution?: "delegated" | "simulated" | "mixed";
  },
): Promise<string> {
  const args = ["work", "start", slug];
  if (policy?.review !== undefined) args.push("--review", policy.review);
  if (policy?.execution !== undefined) args.push("--execution", policy.execution);
  const result = await invoke(args, root);
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
    ["launch", "complete", launch.recordPath, "--agent-id", paseoAgentId, "--status", "Idle"],
    root,
  );
  return { result, content };
}

async function finalizedSimulationRecord(
  root: string,
  role: "designer" | "critic" | "application-worker",
  phase: "decomposition" | "verification" | "implementation",
  response: string,
  at: Date,
): Promise<string> {
  const launch = await prepareLaunch({
    applicationRoot: root,
    slug: "message-board-search",
    role,
    phase,
    execution: "simulated",
    harness: "coordinator",
    simulationReason: "test fixture",
    timeoutSeconds: 60,
    task: "# Task\n\nTest.\n",
    prompt: "# Prompt\n\nTest.\n",
    grant: {
      readableAreas: [],
      writableAreas: [],
      toolKinds: [],
      projectShell: "none",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    },
    retainedSources: [],
    at,
  });
  await writeFile(launch.record.response.path, response, "utf8");
  await finalizeSimulation({ recordPath: launch.path, status: "completed" });
  return launch.path;
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("skill CLI help and arguments", () => {
  test("resolves skill assets from source and packaged command layouts", () => {
    expect(
      defaultSkillRootForCommand(resolve("/package/skills/sync-engine/scripts/command.ts")),
    ).toBe(resolve("/package/skills/sync-engine"));
    expect(defaultSkillRootForCommand(resolve("/package/dist/command.js"))).toBe(
      resolve("/package/skills/sync-engine"),
    );
  });

  test("documents the complete small command surface", async () => {
    const root = await application("help");
    const expected = await readFile(resolve(expectedRoot, "help.txt"), "utf8");
    expect(await invoke([], root)).toEqual({ code: 0, stdout: expected, stderr: "" });
  });

  test("creates role-aware grants and recommends the native harness", async () => {
    const root = await application("grant-and-harness");
    const grant = await invoke(
      ["grant", "init", "--role", "designer", "--phase", "decomposition"],
      root,
    );
    expect(JSON.parse(grant.stdout)).toEqual({
      readableAreas: [],
      writableAreas: [{ area: "current-decomposition", path: "decomposition.md" }],
      toolKinds: ["repository-read", "repository-write"],
      projectShell: "none",
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    });
    const recommendation = await invoke(["harness", "recommend"], root, {
      environment: { PI_CODING_AGENT: "true", PASEO_AGENT_ID: "outer" },
    });
    expect(recommendation.stdout).toContain("Recommended execution harness: paseo");
    expect(recommendation.stdout).toContain("Current supervisor: paseo");
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
    [["launch", "wait", "record.json", "--complete"], "Unknown option for launch wait: --complete"],
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
    const first = await invoke(
      ["work", "start", "durable-board", "--review", "omitted", "--execution", "simulated"],
      root,
      {
        bootstrapDependencies: injectedBootstrap,
        bootstrap: async (options, dependencies) => {
          calls.push(options);
          expect(dependencies).toBe(injectedBootstrap);
          return bootstrapResult(options.applicationRoot, "continued-with-warning", [
            "Continuing with the usable installed release",
          ]);
        },
      },
    );
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
      Policy: ["review omitted; execution simulated"],
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

  test("enforces the execution policy selected at work start", async () => {
    const root = await application("execution-policy");
    const unit = await started(root, "message-board-search", { execution: "delegated" });
    const task = await copyFixture(root, "initial-task.md");
    const grant = await copyFixture(root, "designer-grant.json");
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
        task,
        "--grant",
        grant,
        "--simulate",
        "not permitted",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
      ],
      root,
    );
    expect(result).toEqual(
      cliFailure(
        "Work item execution policy is delegated",
        "Use the execution mode selected when the work item was created.",
      ),
    );
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
      policy: { review: "required", execution: "mixed" },
    });
    expect((await readdir(unit)).sort()).toHaveLength(8);
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
      title: preparedOutput["Agent title"],
      delivery: preparedOutput["Prompt delivery"],
      cwd: preparedOutput["Working directory"],
      timeout: preparedOutput.Timeout,
      sources: preparedOutput["Prompt sources (bytes)"],
      target: preparedOutput.Target,
      native: preparedOutput.Native,
      launch: preparedOutput.Launch,
      capture: preparedOutput.Capture,
      agentInstruction: preparedOutput["Agent instruction"],
      warning: preparedOutput.Warning,
    }).toEqual({
      prepared: ["designer/decomposition"],
      prompt: [launch.promptPath],
      response: [launch.responsePath],
      record: [launch.recordPath],
      harness: ["paseo"],
      title: ["message-board-search — Designer; --title"],
      delivery: ["agent-file-instruction; the paseo run positional prompt"],
      cwd: [`${root}; explicit-application-cwd`],
      timeout: ["1800 seconds; observation limit carried in instruction (CLI does not enforce)"],
      sources: [expect.stringContaining("brief ")],
      target: ["fresh agent"],
      native: ["Paseo CLI; paseo run"],
      launch: [
        `sync-engine-skill launch paseo ${JSON.stringify(launch.recordPath)} --provider <provider> --model <model> [--thinking <id>]`,
      ],
      capture: undefined,
      agentInstruction: [
        `Read and follow the complete assignment in this prompt file:\n${launch.promptPath}`,
      ],
      warning: ["paseo capabilities are prompt-guided rather than harness-enforced."],
    });
    const stem = "2026-08-19T09-06-43Z-designer-decomposition";
    expect((await readdir(unit)).sort()).toEqual([
      `${stem}.baseline.json`,
      `${stem}.capabilities.json`,
      `${stem}.prompt.md`,
      `${stem}.record.json`,
      `${stem}.response.md`,
      `${stem}.task.md`,
      "brief.md",
      "policy.json",
    ]);

    const configuredRoot = await application("configured-timeout");
    await started(configuredRoot);
    const configured = await prepareInitial(configuredRoot, { timeoutSeconds: 42 });
    expect(await readLaunchRecord(configured.recordPath)).toMatchObject({ timeoutSeconds: 42 });
    expect(parseLabeledOutput(configured.output).Timeout).toEqual([
      "42 seconds; observation limit carried in instruction (CLI does not enforce)",
    ]);
  });

  test("warns without blocking when access exceeds a role recommendation", async () => {
    const root = await application("recommendation-warning");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const sourceGrant = JSON.parse(
      await readFile(resolve(fixtureRoot, "designer-grant.json"), "utf8"),
    ) as Record<string, unknown>;
    const grant = resolve(root, "coordination/designer-network-grant.json");
    await writeFile(grant, `${JSON.stringify({ ...sourceGrant, network: true }, undefined, 2)}\n`);
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
    ] as const;

    const prepared = await invoke(base, root);
    expect(prepared).toMatchObject({ code: 0, stderr: "" });
    expect(parseLabeledOutput(prepared.stdout).Warning).toEqual([
      "designer/decomposition access exceeds role recommendations: network. Record the choice in the work brief when consequential.",
      "paseo capabilities are prompt-guided rather than harness-enforced.",
    ]);
    const record = await readLaunchRecord(reported(prepared.stdout, "Record"));
    expect(record.grant.network).toBe(true);
    expect(await readFile(record.prompt.path, "utf8")).toContain("network: yes");
  });

  test("launches Paseo in the background and repeats short waits until idle", async () => {
    const root = await application("paseo-wait-loop");
    await started(root);
    const launch = await prepareInitial(root);
    const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = [];
    const paseoCommand = fakePaseo(
      [
        { output: JSON.stringify({ agentId: paseoAgentId, status: "running" }) },
        { output: JSON.stringify({ agentId: paseoAgentId, status: "timeout" }) },
        { output: JSON.stringify({ agentId: paseoAgentId, status: "idle" }) },
        { output: "## Status\n\nComplete\n\n## Checks\n\nPassed\n" },
      ],
      calls,
    );

    const launched = await invoke(
      [
        "launch",
        "paseo",
        launch.recordPath,
        "--provider",
        "pi",
        "--model",
        "gpt-example",
        "--thinking",
        "high",
      ],
      root,
      { paseoCommand },
    );
    expect(launched).toEqual({
      code: 0,
      stdout: `Paseo launched: ${launch.recordPath}\nAgent: paseo:${paseoAgentId}\nStatus: running\nNext: sync-engine-skill launch wait ${JSON.stringify(launch.recordPath)} --slice 45\n`,
      stderr: "",
    });
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "prepared",
      launched: { agentId: paseoAgentId, at: instant.toISOString() },
    });
    const shown = await invoke(["work", "show", "message-board-search"], root);
    expect(shown.stdout).toContain("Run launch wait: 1 launched run still awaiting completion.");
    expect(shown.stdout).toContain(`launched — awaiting paseo:${paseoAgentId}`);

    const settled = await invoke(["launch", "wait", launch.recordPath], root, { paseoCommand });
    expect(settled.code).toBe(0);
    expect(settled.stderr).toBe("");
    expect(settled.stdout).toContain(
      `Status: idle\nResponse: ${launch.responsePath}\nRole result: complete\nComplete: sync-engine-skill launch complete ${JSON.stringify(launch.recordPath)} --status completed\n`,
    );
    expect(settled.stdout).toContain("Status: completed; result: complete");
    expect(await readFile(launch.responsePath, "utf8")).toBe(
      "## Status\n\nComplete\n\n## Checks\n\nPassed\n",
    );
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "finalized",
      agentId: paseoAgentId,
      status: "completed",
    });
    expect(calls).toEqual([
      {
        args: [
          "--json",
          "run",
          "-d",
          "--cwd",
          root,
          "--title",
          "message-board-search — Designer",
          "--provider",
          "pi",
          "--model",
          "gpt-example",
          "--thinking",
          "high",
          `Read and follow the complete assignment in this prompt file:\n${launch.promptPath}`,
        ],
        cwd: root,
      },
      { args: ["wait", paseoAgentId, "--timeout", "45", "--json"], cwd: root },
      { args: ["wait", paseoAgentId, "--timeout", "45", "--json"], cwd: root },
      { args: ["logs", paseoAgentId, "--filter", "text", "--tail", "1"], cwd: root },
    ]);
  });

  test("leaves an unknown Paseo result for manual inspection and completion", async () => {
    const root = await application("paseo-unknown-shape");
    await started(root);
    const launch = await prepareInitial(root);
    const paseoCommand = fakePaseo(
      [
        { output: JSON.stringify({ agentId: paseoAgentId, status: "running" }) },
        { output: JSON.stringify({ agentId: paseoAgentId, status: "running" }) },
        { output: JSON.stringify({ agentId: paseoAgentId, status: "idle" }) },
        { output: "The assignment is done.\n" },
      ],
      [],
    );
    await invoke(
      ["launch", "paseo", launch.recordPath, "--provider", "pi", "--model", "gpt-example"],
      root,
      { paseoCommand },
    );
    const completed = await invoke(["launch", "wait", launch.recordPath], root, {
      paseoCommand,
    });
    expect(completed).toMatchObject({ code: 0, stderr: "" });
    expect(completed.stdout).toContain(`Response: ${launch.responsePath}`);
    expect(completed.stdout).toContain(
      `Role result: unknown\nManual completion after inspecting Response: sync-engine-skill launch complete ${JSON.stringify(launch.recordPath)} --status <completed|blocked>`,
    );
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("prepared");
  });

  test("does not infer fresh Paseo configuration from environment variables", async () => {
    const root = await application("paseo-no-environment-fallback");
    await started(root);
    const launch = await prepareInitial(root);
    const result = await invoke(["launch", "paseo", launch.recordPath], root, {
      environment: { PASEO_PROVIDER: "pi", PASEO_MODEL: "gpt-example" },
    });
    expect(result).toEqual(cliFailure("Fresh Paseo launch requires --provider <value>"));
  });

  test("captures a blocked Paseo result and completes it as blocked", async () => {
    const root = await application("paseo-blocked");
    await started(root);
    const launch = await prepareInitial(root);
    const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = [];
    const result = await invoke(
      ["launch", "paseo", launch.recordPath, "--provider", "pi", "--model", "gpt-example"],
      root,
      {
        paseoCommand: fakePaseo(
          [
            { output: JSON.stringify({ agentId: paseoAgentId, status: "running" }) },
            { output: JSON.stringify({ agentId: paseoAgentId, status: "idle" }) },
            { output: "## Status\n\nBlocked\n\n## Blockers\n\nEnvironment unavailable.\n" },
          ],
          calls,
        ),
      },
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Role result: blocked");
    expect(result.stdout).toContain(`--status blocked\n`);
    expect(result.stdout).toContain("Status: blocked; result: blocked");
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "finalized",
      status: "blocked",
      result: "blocked",
    });
  });

  test("supports manual capture with no-complete and recorded-agent completion", async () => {
    const root = await application("paseo-no-complete");
    await started(root);
    const launch = await prepareInitial(root);
    const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = [];
    const paseoCommand = fakePaseo(
      [
        { output: JSON.stringify({ agentId: paseoAgentId, status: "running" }) },
        { output: JSON.stringify({ agentId: paseoAgentId, status: "timeout" }) },
        { output: JSON.stringify({ agentId: paseoAgentId, status: "idle" }) },
        { output: "## Status\n\nComplete\n" },
      ],
      calls,
    );
    expect(
      await invoke(
        ["launch", "paseo", launch.recordPath, "--provider", "pi", "--model", "gpt-example"],
        root,
        { paseoCommand },
      ),
    ).toMatchObject({ code: 0, stderr: "" });
    const captured = await invoke(["launch", "wait", launch.recordPath, "--no-complete"], root, {
      paseoCommand,
    });
    expect(captured.stdout).toContain("Role result: complete");
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("prepared");
    expect(
      await invoke(
        [
          "launch",
          "complete",
          launch.recordPath,
          "--status",
          "completed",
          "--agent-id",
          secondPaseoAgentId,
        ],
        root,
      ),
    ).toEqual(cliFailure("--agent-id does not match the agent recorded at launch"));
    expect(
      await invoke(["launch", "complete", launch.recordPath, "--status", "completed"], root),
    ).toMatchObject({ code: 0, stderr: "" });
  });

  test("sends a Paseo continuation without waiting in the send call", async () => {
    const root = await application("paseo-continuation-launch");
    await started(root);
    const initial = await prepareInitial(root);
    await finalizeInitial(root, initial);
    const task = await copyFixture(root, "follow-up-task.md");
    const continuation = await invoke(
      [
        "continue",
        initial.recordPath,
        "--phase",
        "decomposition",
        "--task",
        task,
        "--grant",
        initial.grantPath,
        "--input",
        `brief=${initial.briefPath}`,
      ],
      root,
    );
    const recordPath = reported(continuation.stdout, "Record");
    const promptPath = reported(continuation.stdout, "Prompt");
    const calls: Array<{ readonly args: readonly string[]; readonly cwd: string }> = [];
    const launched = await invoke(["launch", "paseo", recordPath, "--slice", "12"], root, {
      paseoCommand: fakePaseo(
        [
          { output: JSON.stringify({ agentId: paseoAgentId, status: "sent" }) },
          { output: JSON.stringify({ agentId: paseoAgentId, status: "running" }) },
        ],
        calls,
      ),
    });
    expect(launched.code).toBe(0);
    expect(launched.stdout).toContain(`launch wait ${JSON.stringify(recordPath)} --slice 12`);
    expect(calls[0]).toEqual({
      args: [
        "--json",
        "send",
        "--no-wait",
        paseoAgentId,
        `Read and follow the complete assignment in this prompt file:\n${promptPath}`,
      ],
      cwd: root,
    });
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
      Harness: [`paseo; agent ${paseoAgentId}`],
      Status: ["completed; result: complete"],
      Warning: ["paseo capabilities were prompt-guided rather than harness-enforced."],
      Next: ["Prepare a critic for the decomposition."],
    });
    expect(await readFile(launch.responsePath, "utf8")).toBe(content);
    expect(await readLaunchRecord(launch.recordPath)).toMatchObject({
      state: "finalized",
      harness: "paseo",
      agentId: paseoAgentId,
      status: "completed",
      enforcement: "prompt-guided",
    });
  });

  test("refuses an unknown result shape until the response is fixed", async () => {
    const root = await application("shape-warning");
    await started(root);
    const launch = await prepareInitial(root);
    const useful = "The work is complete; no files changed.\n";
    const { result } = await finalizeInitial(root, launch, useful);
    expect(result).toEqual(
      cliFailure(
        "Response has no parsable required `## Status`; expected `Complete` or `Blocked` for designer; fix the response file and rerun completion.",
      ),
    );
    expect(await readFile(launch.responsePath, "utf8")).toBe(useful);
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("prepared");
    await writeFile(launch.responsePath, "## Status\n\nComplete\n", "utf8");
    expect(
      await invoke(
        [
          "launch",
          "complete",
          launch.recordPath,
          "--agent-id",
          paseoAgentId,
          "--status",
          "completed",
        ],
        root,
      ),
    ).toMatchObject({ code: 0, stderr: "" });
  });

  test("records coordinator simulation without inventing an agent identity", async () => {
    const root = await application("simulation");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const grant = await copyFixture(root, "designer-grant.json");
    const prepared = await invoke(
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
        "--simulate",
        "delegation-unavailable",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
      ],
      root,
    );
    expect(prepared).toMatchObject({ code: 0, stderr: "" });
    const output = parseLabeledOutput(prepared.stdout);
    expect(output["Coordinator simulation prepared"]).toEqual(["designer/decomposition"]);
    expect(output.Reason).toEqual(["delegation-unavailable"]);
    const recordPath = reported(prepared.stdout, "Record");
    const responsePath = reported(prepared.stdout, "Response");
    expect(await readLaunchRecord(recordPath)).toMatchObject({
      state: "prepared",
      execution: "simulated",
      independent: false,
      harness: "coordinator",
      simulationReason: "delegation-unavailable",
    });

    await writeFile(responsePath, "## Status\n\nComplete\n", "utf8");
    const completed = await invoke(
      ["simulation", "complete", recordPath, "--status", "completed"],
      root,
    );
    expect(completed).toMatchObject({ code: 0, stderr: "" });
    const finalized = await readLaunchRecord(recordPath);
    expect(finalized).toMatchObject({
      state: "finalized",
      execution: "simulated",
      independent: false,
      harness: "coordinator",
      status: "completed",
    });
    expect("agentId" in finalized).toBe(false);

    const continued = await invoke(
      [
        "continue",
        recordPath,
        "--phase",
        "decomposition",
        "--task",
        task,
        "--grant",
        grant,
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
      ],
      root,
      { now: () => new Date("2026-08-19T09:07:00.000Z") },
    );
    expect(continued).toMatchObject({ code: 0, stderr: "" });
    const continuedRecord = await readLaunchRecord(reported(continued.stdout, "Record"));
    expect(continuedRecord).toMatchObject({
      state: "prepared",
      execution: "simulated",
      harness: "coordinator",
      relationship: { kind: "simulation-continuation", recordPath },
    });
    expect(await readFile(continuedRecord.prompt.path, "utf8")).toContain(
      "The prior same-phase role contract remains authoritative.",
    );
    await writeFile(continuedRecord.response.path, "## Status\n\nComplete.\n", "utf8");
    expect(
      (
        await invoke(
          ["simulation", "complete", reported(continued.stdout, "Record"), "--status", "completed"],
          root,
        )
      ).code,
    ).toBe(0);

    const shown = await invoke(["work", "show", "message-board-search"], root);
    expect(shown).toMatchObject({ code: 0, stderr: "" });
    expect(shown.stdout).toContain("coordinator simulation (delegation-unavailable)");
    expect(shown.stdout).toContain("## Active decisions");
  });

  test("requires verification once a review chain starts", async () => {
    const root = await application("active-review-gate");
    const unit = await started(root);
    const designer = await prepareInitial(root);
    expect((await finalizeInitial(root, designer)).result.code).toBe(0);
    const decomposition = resolve(unit, "decomposition.md");
    await writeFile(decomposition, "# Candidate\n\nNeeds revision.\n", "utf8");
    const criticTask = await copyFixture(root, "initial-task.md");
    const criticGrant = resolve(root, "coordination/critic-decomposition-grant.json");
    await writeFile(
      criticGrant,
      `${JSON.stringify({
        readableAreas: [],
        writableAreas: [],
        toolKinds: [],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      })}\n`,
    );
    const review = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "critic",
        "--phase",
        "decomposition",
        "--task",
        criticTask,
        "--grant",
        criticGrant,
        "--simulate",
        "test review",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `candidate-decomposition=${decomposition}`,
      ],
      root,
      { now: () => new Date("2026-08-19T09:08:00.000Z") },
    );
    expect(review.code).toBe(0);
    const reviewRecord = await readLaunchRecord(reported(review.stdout, "Record"));
    expect(parseLabeledOutput(review.stdout)["Review target"]).toEqual([
      `decomposition ${reviewRecord.review?.digest}`,
    ]);
    await writeFile(
      reviewRecord.response.path,
      "## Verdict\n\nRevise.\n## Assessments\n\nBoundary issue.\n## Findings\n\nD-1.\n",
    );
    const reviewCompletion = await invoke(
      ["simulation", "complete", reported(review.stdout, "Record"), "--status", "completed"],
      root,
    );
    expect(reviewCompletion.code).toBe(0);
    expect(parseLabeledOutput(reviewCompletion.stdout).Next).toEqual([
      "Continue the designer with these findings, then continue this critic for verification.",
    ]);

    const contractTask = await copyFixture(root, "follow-up-task.md");
    const contractGrant = await copyFixture(root, "designer-contracts-grant.json");
    const transition = await invoke(
      [
        "continue",
        designer.recordPath,
        "--phase",
        "contracts",
        "--task",
        contractTask,
        "--grant",
        contractGrant,
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `accepted-decomposition=${decomposition}`,
      ],
      root,
    );
    expect(transition).toEqual(
      cliFailure(
        "Decomposition changed after its last approving review",
        "Continue the critic through verification of the current candidate.",
      ),
    );
  });

  test("reports review targets, oversized context, and unparsable required verdicts", async () => {
    const root = await application("critic-mechanics");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const grant = resolve(root, "coordination/critic-empty-grant.json");
    await writeFile(
      grant,
      `${JSON.stringify({
        readableAreas: [],
        writableAreas: [],
        toolKinds: [],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      })}\n`,
    );
    const candidate = resolve(unit, "decomposition.md");
    await writeFile(candidate, "# Candidate\n", "utf8");
    const largeContext = resolve(root, "coordination/large-context.md");
    await writeFile(largeContext, `${"x".repeat(50_000)}\n`, "utf8");
    const prepared = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "critic",
        "--phase",
        "decomposition",
        "--task",
        task,
        "--grant",
        grant,
        "--simulate",
        "test",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `candidate-decomposition=${candidate}`,
        "--input",
        `context=${largeContext}`,
      ],
      root,
    );
    expect(prepared.code).toBe(0);
    const fields = parseLabeledOutput(prepared.stdout);
    expect(fields["Review target"]?.[0]).toMatch(/^decomposition [a-f0-9]{64}$/);
    expect(fields.Warning).toContainEqual(
      expect.stringMatching(
        /large-context\.md \(50001 bytes\) exceeds the built-in role kit \(\d+\); prefer an exact excerpt\./,
      ),
    );
    const record = await readLaunchRecord(reported(prepared.stdout, "Record"));
    await writeFile(record.response.path, "## Summary\n\nLooks good.\n", "utf8");
    expect(
      await invoke(
        ["simulation", "complete", reported(prepared.stdout, "Record"), "--status", "completed"],
        root,
      ),
    ).toEqual(
      cliFailure(
        "Response has no parsable required `## Verdict`; expected `Approve`, `Revise`, or `Blocked` for critic; fix the response file and rerun completion.",
      ),
    );
  });

  test("warns when required-policy critic verification binds no review target", async () => {
    const root = await application("critic-no-target");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const grant = resolve(root, "coordination/critic-empty-grant.json");
    await writeFile(
      grant,
      `${JSON.stringify({
        readableAreas: [],
        writableAreas: [],
        toolKinds: [],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      })}\n`,
    );
    const findings = resolve(root, "coordination/findings.md");
    const excerpt = resolve(root, "coordination/revised-excerpt.md");
    const guidance = resolve(root, "coordination/review-guidance.md");
    await writeFile(findings, "D-1\n");
    await writeFile(excerpt, "Revised excerpt outside design.\n");
    await writeFile(guidance, "Review D-1.\n");
    const result = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "critic",
        "--phase",
        "verification",
        "--task",
        task,
        "--grant",
        grant,
        "--simulate",
        "test",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `original-findings=${findings}`,
        "--input",
        `revised-candidate=${excerpt}`,
        "--input",
        `review-guidance=${guidance}`,
      ],
      root,
    );
    expect(result).toMatchObject({ code: 0, stderr: "" });
    expect(parseLabeledOutput(result.stdout)["Review target"]).toBeUndefined();
    expect(parseLabeledOutput(result.stdout).Warning).toContain(
      "this critic run binds no review target and will not satisfy the review policy.",
    );
  });

  test("runs authored structure validation before semantic contract criticism", async () => {
    const root = await application("critic-preflight");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const design = resolve(root, "design/concepts");
    await mkdir(design, { recursive: true });
    const changed = resolve(design, "Posting.md");
    await writeFile(changed, "# malformed\n");
    const grant = resolve(root, "coordination/critic-grant.json");
    await writeFile(
      grant,
      `${JSON.stringify({
        readableAreas: [{ area: "design", path: "concepts/Posting.md" }],
        writableAreas: [],
        toolKinds: ["repository-read"],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      })}\n`,
    );
    const result = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "critic",
        "--phase",
        "contracts",
        "--task",
        task,
        "--grant",
        grant,
        "--harness",
        "paseo",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `changed-contracts=${changed}`,
        "--concepts-only",
        "this application intentionally exposes concepts only",
      ],
      root,
      { designCheck: async () => ({ exitCode: 1, output: "duplicate H1\n" }) },
    );
    expect(result).toEqual(
      cliFailure(
        "Contract syntax validation failed before semantic criticism:\nduplicate H1",
        "Continue the contract designer with these diagnostics, then rerun the critic preparation.",
      ),
    );
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
      [
        "launch",
        "complete",
        launch.recordPath,
        "--agent-id",
        paseoAgentId,
        "--status",
        "completed",
      ],
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
      [
        "launch",
        "complete",
        launch.recordPath,
        "--agent-id",
        paseoAgentId,
        "--status",
        "completed",
      ],
      root,
    );
    expect(completed).toEqual(cliFailure(`Native response is empty: ${launch.responsePath}`));
    expect((await readLaunchRecord(launch.recordPath)).state).toBe("prepared");

    const failed = await invoke(
      ["launch", "complete", launch.recordPath, "--agent-id", paseoAgentId, "--status", "failed"],
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

    const invalidRoot = await application("invalid-response");
    await started(invalidRoot);
    const invalidLaunch = await prepareInitial(invalidRoot);
    await writeFile(invalidLaunch.responsePath, Uint8Array.from([0xc3, 0x28]));
    const invalid = await invoke(
      [
        "launch",
        "complete",
        invalidLaunch.recordPath,
        "--agent-id",
        secondPaseoAgentId,
        "--status",
        "failed",
      ],
      invalidRoot,
    );
    expect(invalid).toEqual(
      cliFailure(`Native response is not valid UTF-8: ${invalidLaunch.responsePath}`),
    );
    expect((await readLaunchRecord(invalidLaunch.recordPath)).state).toBe("prepared");
  });

  test("makes unfinished work loud and allows an explicit pre-launch adapter correction", async () => {
    const root = await application("unfinished-adapter");
    await started(root);
    const launch = await prepareInitial(root);
    const shown = await invoke(["work", "show", "message-board-search"], root);
    expect(shown.stdout).toContain("ACTION REQUIRED: 1 unfinished run");
    expect(await invoke(["work", "finish", "message-board-search"], root)).toEqual(
      cliFailure(
        "Work item message-board-search has 1 unfinished prepared run",
        "Finalize each run, then rerun work finish before handback.",
      ),
    );

    const changed = await invoke(["launch", "adapter", launch.recordPath, "--harness", "pi"], root);
    expect(changed).toMatchObject({ code: 0, stderr: "" });
    expect(changed.stdout).toContain("Prepared launch adapter changed: paseo -> pi");
    expect((await readLaunchRecord(launch.recordPath)).harness).toBe("pi");
    const wrongIdentity = await invoke(
      ["launch", "complete", launch.recordPath, "--agent-id", paseoAgentId, "--status", "failed"],
      root,
    );
    expect(wrongIdentity.stderr).toContain("is not a valid Pi session ID for pi");
    const completed = await invoke(
      [
        "launch",
        "complete",
        launch.recordPath,
        "--agent-id",
        "01a05c1f-e5d2-7c92-9a6d-e6883393f526",
        "--status",
        "failed",
      ],
      root,
    );
    expect(completed.code).toBe(0);
    expect(await invoke(["work", "finish", "message-board-search"], root)).toMatchObject({
      code: 0,
      stderr: "",
    });
  });

  test("requires approval of the final design after implementation repair", async () => {
    const root = await application("final-review");
    await started(root);
    const designRoot = resolve(root, "design");
    const contract = resolve(designRoot, "concepts/Posting.md");
    await mkdir(resolve(designRoot, "concepts"), { recursive: true });
    await writeFile(contract, "# Posting\n", "utf8");
    const initialDigest = (await digestDesign(designRoot)).digest;
    const writer = await prepareLaunch({
      applicationRoot: root,
      slug: "message-board-search",
      role: "designer",
      phase: "contracts",
      execution: "simulated",
      harness: "coordinator",
      simulationReason: "test",
      timeoutSeconds: 30,
      task: "Write contracts.",
      prompt: "# Role and objective\n\nWrite contracts.\n",
      grant: {
        readableAreas: [],
        writableAreas: [{ area: "assigned-design", path: "concepts/Posting.md" }],
        toolKinds: ["repository-read", "repository-write"],
        projectShell: "project-validation",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      },
      retainedSources: [],
      design: { root: designRoot, digest: initialDigest },
      at: new Date("2026-08-19T10:00:00.000Z"),
    });
    await writeFile(contract, "# Posting\n\nApproved contract.\n", "utf8");
    await writeFile(writer.record.response.path, "## Status\n\nComplete.\n");
    await finalizeSimulation({ recordPath: writer.path, status: "completed" });

    const approvedDigest = (await digestDesign(designRoot)).digest;
    const critic = await prepareLaunch({
      applicationRoot: root,
      slug: "message-board-search",
      role: "critic",
      phase: "contracts",
      execution: "simulated",
      harness: "coordinator",
      simulationReason: "test",
      timeoutSeconds: 30,
      task: "Review contracts.",
      prompt: "# Role and objective\n\nReview contracts.\n",
      grant: {
        readableAreas: [],
        writableAreas: [],
        toolKinds: [],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      },
      retainedSources: [],
      design: { root: designRoot, digest: approvedDigest },
      review: { subject: "design", digest: approvedDigest },
      at: new Date("2026-08-19T10:01:00.000Z"),
    });
    await writeFile(critic.record.response.path, "## Verdict\n\nApprove.\n");
    await finalizeSimulation({ recordPath: critic.path, status: "completed" });

    const worker = await prepareLaunch({
      applicationRoot: root,
      slug: "message-board-search",
      role: "concept-worker",
      phase: "implementation",
      execution: "simulated",
      harness: "coordinator",
      simulationReason: "test",
      timeoutSeconds: 30,
      task: "Implement.",
      prompt: "# Role and objective\n\nImplement.\n",
      grant: {
        readableAreas: [],
        writableAreas: [],
        toolKinds: [],
        projectShell: "none",
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      },
      retainedSources: [],
      design: { root: designRoot, digest: approvedDigest },
      at: new Date("2026-08-19T10:02:00.000Z"),
    });
    await writeFile(worker.record.response.path, "## Status\n\nComplete.\n");
    await finalizeSimulation({ recordPath: worker.path, status: "completed" });

    await writeFile(contract, "# Posting\n\nFinal repaired contract.\n", "utf8");
    const finalDigest = (await digestDesign(designRoot)).digest;
    expect(await invoke(["work", "finish", "message-board-search"], root)).toEqual(
      cliFailure(
        `Work item message-board-search cannot finish: final design digest ${finalDigest} has no approving critic record`,
        "Continue the critic through verification of the current design, then rerun work finish.",
      ),
    );

    await writeFile(
      resolve(root, ".sync-engine/work/message-board-search/policy.json"),
      `${JSON.stringify({ review: "omitted", execution: "mixed" }, undefined, 2)}\n`,
    );
    expect(await invoke(["work", "finish", "message-board-search"], root)).toEqual(
      cliFailure("Work policy changed after the first run was prepared"),
    );
    expect(await invoke(["work", "show", "message-board-search"], root)).toEqual(
      cliFailure("Work policy changed after the first run was prepared"),
    );
  });

  test("prints concrete approval, worker, and blocker next-step cues", async () => {
    const simpleGrant = {
      readableAreas: [],
      writableAreas: [],
      toolKinds: [],
      projectShell: "none" as const,
      network: false,
      generatedOutput: false,
      longRunningProcesses: false,
    };
    const completeSimulation = async (root: string, path: string, response: string) => {
      const record = await readLaunchRecord(path);
      await writeFile(record.response.path, response, "utf8");
      return invoke(
        [
          "simulation",
          "complete",
          path,
          "--status",
          response.includes("Blocked") ? "blocked" : "completed",
        ],
        root,
      );
    };

    const decompositionRoot = await application("next-decomposition-approval");
    await started(decompositionRoot);
    const decompositionReview = await prepareLaunch({
      applicationRoot: decompositionRoot,
      slug: "message-board-search",
      role: "critic",
      phase: "decomposition",
      execution: "simulated",
      harness: "coordinator",
      simulationReason: "test",
      timeoutSeconds: 30,
      task: "Review.",
      prompt: "# Review\n",
      grant: simpleGrant,
      retainedSources: [],
      review: { subject: "decomposition", digest: "d".repeat(64) },
    });
    const decompositionDone = await completeSimulation(
      decompositionRoot,
      decompositionReview.path,
      "## Verdict\n\nApprove\n",
    );
    expect(parseLabeledOutput(decompositionDone.stdout).Next).toEqual([
      "Continue the decomposition designer into contracts with the approved decomposition.",
    ]);

    const designRoot = await application("next-design-approval");
    await started(designRoot);
    const designReview = await prepareLaunch({
      applicationRoot: designRoot,
      slug: "message-board-search",
      role: "critic",
      phase: "contracts",
      execution: "simulated",
      harness: "coordinator",
      simulationReason: "test",
      timeoutSeconds: 30,
      task: "Review.",
      prompt: "# Review\n",
      grant: simpleGrant,
      retainedSources: [],
      review: { subject: "design", digest: "e".repeat(64) },
    });
    const designDone = await completeSimulation(
      designRoot,
      designReview.path,
      "## Verdict: approve\n",
    );
    expect(parseLabeledOutput(designDone.stdout).Next).toEqual([
      "Prepare the implementation roles against the approved design digest.",
    ]);

    for (const [category, expected] of [
      [
        "design",
        "Route the design blocker to the designer, then continue the blocked role with the resolution.",
      ],
      [
        "context",
        "Prepare a new prompt with the exact missing context, then continue the blocked role.",
      ],
      ["environment", "Resolve the environment blocker, then continue the blocked role."],
      [
        "interrupted",
        "Continue the same agent with the same assignment before doing anything else.",
      ],
    ] as const) {
      const blockedRoot = await application(`next-${category}-blocker`);
      await started(blockedRoot);
      const blocked = await prepareLaunch({
        applicationRoot: blockedRoot,
        slug: "message-board-search",
        role: "concept-worker",
        phase: "implementation",
        execution: "simulated",
        harness: "coordinator",
        simulationReason: "test",
        timeoutSeconds: 30,
        task: "Implement.",
        prompt: "# Implement\n",
        grant: simpleGrant,
        retainedSources: [],
      });
      const done = await completeSimulation(
        blockedRoot,
        blocked.path,
        `## Status\n\nBlocked\n\n## Blockers\n\n${category}: unavailable\n`,
      );
      expect(parseLabeledOutput(done.stdout).Next).toEqual([expected]);
    }
  });

  test("prints worker handback or current-design verification cues", async () => {
    const workerCue = async (label: string, approveCurrent: boolean) => {
      const root = await application(label);
      await started(root);
      const designRoot = resolve(root, "design");
      await mkdir(resolve(designRoot, "concepts"), { recursive: true });
      const contract = resolve(designRoot, "concepts/Posting.md");
      await writeFile(contract, "# Posting\n", "utf8");
      const initial = (await digestDesign(designRoot)).digest;
      const noWrite = {
        readableAreas: [],
        writableAreas: [],
        toolKinds: [],
        projectShell: "none" as const,
        network: false,
        generatedOutput: false,
        longRunningProcesses: false,
      };
      const designer = await prepareLaunch({
        applicationRoot: root,
        slug: "message-board-search",
        role: "designer",
        phase: "contracts",
        execution: "simulated",
        harness: "coordinator",
        simulationReason: "test",
        timeoutSeconds: 30,
        task: "Design.",
        prompt: "# Design\n",
        grant: noWrite,
        retainedSources: [],
        design: { root: designRoot, digest: initial },
      });
      await writeFile(designer.record.response.path, "## Status\n\nComplete\n");
      await finalizeSimulation({ recordPath: designer.path, status: "completed" });
      const approvedDigest = (await digestDesign(designRoot)).digest;
      const critic = await prepareLaunch({
        applicationRoot: root,
        slug: "message-board-search",
        role: "critic",
        phase: "contracts",
        execution: "simulated",
        harness: "coordinator",
        simulationReason: "test",
        timeoutSeconds: 30,
        task: "Review.",
        prompt: "# Review\n",
        grant: noWrite,
        retainedSources: [],
        review: { subject: "design", digest: approvedDigest },
      });
      await writeFile(critic.record.response.path, "## Verdict\n\nApprove\n");
      await finalizeSimulation({ recordPath: critic.path, status: "completed" });
      if (!approveCurrent) await writeFile(contract, "# Posting\n\nRepaired.\n", "utf8");
      const current = (await digestDesign(designRoot)).digest;
      const worker = await prepareLaunch({
        applicationRoot: root,
        slug: "message-board-search",
        role: "concept-worker",
        phase: "implementation",
        execution: "simulated",
        harness: "coordinator",
        simulationReason: "test",
        timeoutSeconds: 30,
        task: "Implement.",
        prompt: "# Implement\n",
        grant: noWrite,
        retainedSources: [],
        design: { root: designRoot, digest: current },
      });
      const response = await readLaunchRecord(worker.path);
      await writeFile(response.response.path, "## Status\n\nComplete\n");
      return invoke(["simulation", "complete", worker.path, "--status", "completed"], root);
    };

    const satisfied = await workerCue("next-worker-satisfied", true);
    expect(parseLabeledOutput(satisfied.stdout).Next).toEqual([
      "Validate the application, then run `sync-engine-skill work finish message-board-search`.",
    ]);
    const stale = await workerCue("next-worker-stale-review", false);
    expect(parseLabeledOutput(stale.stdout).Next).toEqual([
      "Continue the critic for verification of the current design, then retry handback.",
    ]);
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
        paseoAgentId,
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

  test("gates handback on the latest critic and product boundaries with recorded acceptance", async () => {
    const root = await application("handback-gates");
    const unit = await started(root);
    const criticPath = await finalizedSimulationRecord(
      root,
      "critic",
      "verification",
      "## Verdict\n\nRevise\n\n## Findings\n\n- D-7 Unresolved\n- API-2 regressed\n",
      new Date("2026-08-19T09:10:00.000Z"),
    );
    await mkdir(resolve(root, "src/generated"), { recursive: true });
    await writeFile(
      resolve(root, "src/server.ts"),
      'import thing from "../node_modules/example/dist/thing.js";\nconst pathname = new URL(req.url).pathname;\n',
    );
    await writeFile(resolve(root, "src/direct.ts"), 'import thing from "dist/thing.js";\n');
    await writeFile(
      resolve(root, "src/handler.ts"),
      'import { createSyncHandler } from "@mit-sdg/sync-engine-http";\nBun.serve({ fetch: createSyncHandler({} as never) });\n',
    );
    await writeFile(resolve(root, "src/generated/ignored.ts"), "Bun.serve({});\n");
    await mkdir(resolve(root, "src/concepts"), { recursive: true });
    await writeFile(
      resolve(root, "src/concepts/Shortening.ts"),
      "export const valid = (target: string) => new URL(target).pathname.length > 0;\n",
    );

    const stem = basename(criticPath).replace(/\.record\.json$/, "");
    const shown = await invoke(["work", "show", "message-board-search"], root);
    expect(shown.stdout).not.toContain("src/concepts/Shortening.ts");
    expect(shown.stdout).toContain(`Last critic verdict: revise (${stem})`);
    expect(shown.stdout).toContain("Unresolved critic findings: D-7, API-2");
    expect(shown.stdout).toContain("Internal imports: src/direct.ts:1, src/server.ts:1");
    expect(shown.stdout).toContain("Parallel router: src/server.ts");
    expect(shown.stdout).not.toContain("src/handler.ts,");

    expect(await invoke(["work", "finish", "message-board-search"], root)).toEqual(
      cliFailure(
        `Work item message-board-search cannot finish:\ncritic-verdict\nLast critic verdict: revise (${stem})\nUnresolved critic findings: D-7, API-2\ninternal-imports\nsrc/direct.ts:1, src/server.ts:1\nparallel-router\nsrc/server.ts`,
        "Resolve critic-verdict or rerun with --accept critic-verdict=<reason>. Resolve internal-imports or rerun with --accept internal-imports=<reason>. Resolve parallel-router or rerun with --accept parallel-router=<reason>.",
      ),
    );
    const accepted = await invoke(
      [
        "work",
        "finish",
        "message-board-search",
        "--accept",
        "critic-verdict=known review debt",
        "--accept",
        "internal-imports=temporary migration",
        "--accept",
        "parallel-router=legacy endpoint",
      ],
      root,
    );
    expect(accepted.stdout).toContain(
      "Accepted handback check: critic-verdict (known review debt)",
    );
    expect(accepted.stdout).toContain(
      "Accepted handback check: internal-imports (temporary migration)",
    );
    expect(accepted.stdout).toContain("Accepted handback check: parallel-router (legacy endpoint)");
    expect(JSON.parse(await readFile(resolve(unit, "handback.json"), "utf8"))).toEqual({
      accepted: [
        { check: "critic-verdict", reason: "known review debt", at: instant.toISOString() },
        { check: "internal-imports", reason: "temporary migration", at: instant.toISOString() },
        { check: "parallel-router", reason: "legacy endpoint", at: instant.toISOString() },
      ],
    });
    expect((await invoke(["work", "show", "message-board-search"], root)).stdout).toContain(
      "Accepted handback check: critic-verdict (known review debt)",
    );
  });

  test("does not record acceptance for a check that is not failing", async () => {
    const root = await application("nonfailing-acceptance");
    const unit = await started(root);
    const result = await invoke(
      [
        "work",
        "finish",
        "message-board-search",
        "--accept",
        "internal-imports=not currently failing",
      ],
      root,
    );
    expect(result).toMatchObject({ code: 0, stderr: "" });
    await expect(readFile(resolve(unit, "handback.json"), "utf8")).rejects.toThrow();
    expect(result.stdout).not.toContain("Accepted handback check");
  });

  test("requires an application contract or records a concepts-only review scope", async () => {
    const root = await application("concepts-only");
    const unit = await started(root);
    const task = await copyFixture(root, "initial-task.md");
    const concept = resolve(root, "design/concepts/Posting.md");
    await mkdir(resolve(root, "design/concepts"), { recursive: true });
    await writeFile(concept, "# Posting\n");
    const grant = resolve(root, "coordination/critic-contract-grant.json");
    await writeFile(
      grant,
      `${JSON.stringify({ readableAreas: [{ area: "design", path: "concepts/Posting.md" }], writableAreas: [], toolKinds: ["repository-read"], projectShell: "none", network: false, generatedOutput: false, longRunningProcesses: false })}\n`,
    );
    const args = [
      "prompt",
      "build",
      "--work",
      "message-board-search",
      "--role",
      "critic",
      "--phase",
      "contracts",
      "--task",
      task,
      "--grant",
      grant,
      "--simulate",
      "test",
      "--input",
      `brief=${resolve(unit, "brief.md")}`,
      "--input",
      `changed-contracts=${concept}`,
    ];
    expect(await invoke(args, root)).toEqual(
      cliFailure(
        "Application contract is missing: critic/contracts requires a contract under design/compositions/",
        "Supply the application contract or rerun with --concepts-only <reason>.",
      ),
    );
    const prepared = await invoke(
      [...args, "--concepts-only", "library package has no application"],
      root,
      {
        designCheck: async () => ({ exitCode: 0, output: "" }),
      },
    );
    expect(prepared.stdout).toContain(
      "Review scope: concepts only (library package has no application)",
    );
    expect(await readLaunchRecord(reported(prepared.stdout, "Record"))).toMatchObject({
      reviewScope: { conceptsOnly: "library package has no application" },
    });
  });

  test("warns for oversized decomposition and nudges batched final-design review", async () => {
    const root = await application("review-warnings");
    const unit = await started(root);
    await finalizedSimulationRecord(
      root,
      "application-worker",
      "implementation",
      "## Status\n\nComplete\n",
      new Date("2026-08-19T09:07:00.000Z"),
    );
    const task = await copyFixture(root, "initial-task.md");
    const decomposition = resolve(unit, "decomposition.md");
    const decompositionText = `# Decisions\n\n${"x".repeat(8_100)}\n`;
    await writeFile(decomposition, decompositionText);
    const emptyGrant = resolve(root, "coordination/critic-warning-grant.json");
    await writeFile(
      emptyGrant,
      `${JSON.stringify({ readableAreas: [], writableAreas: [], toolKinds: [], projectShell: "none", network: false, generatedOutput: false, longRunningProcesses: false })}\n`,
    );
    const decompositionReview = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "critic",
        "--phase",
        "decomposition",
        "--task",
        task,
        "--grant",
        emptyGrant,
        "--simulate",
        "test",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `candidate-decomposition=${decomposition}`,
      ],
      root,
    );
    expect(decompositionReview.stdout).toContain(
      `Warning: decomposition.md is ${Buffer.byteLength(decompositionText)} bytes; the rubric expects a compact decision index. Ask the designer to cut signatures, storage, and restatement before review.`,
    );
    await writeFile(reported(decompositionReview.stdout, "Response"), "## Verdict\n\nApprove\n");
    await invoke(
      [
        "simulation",
        "complete",
        reported(decompositionReview.stdout, "Record"),
        "--status",
        "completed",
      ],
      root,
    );

    const composition = resolve(root, "design/compositions/App.md");
    await mkdir(resolve(root, "design/compositions"), { recursive: true });
    await writeFile(composition, "# App\n");
    const contractReview = await invoke(
      [
        "prompt",
        "build",
        "--work",
        "message-board-search",
        "--role",
        "critic",
        "--phase",
        "contracts",
        "--task",
        task,
        "--grant",
        emptyGrant,
        "--simulate",
        "test",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `changed-contracts=${composition}`,
      ],
      root,
      {
        designCheck: async () => ({ exitCode: 0, output: "" }),
        now: () => new Date("2026-08-19T09:09:00.000Z"),
      },
    );
    expect(contractReview.stdout).toContain(
      "Note: required review binds only the final design digest before work finish; batch further repairs before verifying unless a worker is blocked on this design.",
    );
  });
});

describe("continuation and replacement", () => {
  test("makes same-designer phase continuation the default", async () => {
    const root = await application("designer-phase-default");
    const unit = await started(root);
    const initial = await prepareInitial(root);
    expect((await finalizeInitial(root, initial)).result.code).toBe(0);
    const decomposition = resolve(unit, "decomposition.md");
    await writeFile(decomposition, "# Accepted decomposition\n");
    const task = await copyFixture(root, "follow-up-task.md");
    const grant = await copyFixture(root, "designer-contracts-grant.json");
    const result = await invoke(
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
        grant,
        "--harness",
        "paseo",
        "--input",
        `brief=${resolve(unit, "brief.md")}`,
        "--input",
        `accepted-decomposition=${decomposition}`,
      ],
      root,
    );
    expect(result.stderr).toContain(
      "A finalized decomposition designer already owns this work item",
    );
    expect(result.stderr).toContain(`Continue ${initial.recordPath} into contracts`);

    const simulatedRoot = await application("simulated-designer-phase-default");
    const simulatedUnit = await started(simulatedRoot);
    const prior = await finalizedSimulationRecord(
      simulatedRoot,
      "designer",
      "decomposition",
      "## Status\n\nComplete\n",
      new Date("2026-08-19T09:08:00.000Z"),
    );
    const simulatedDecomposition = resolve(simulatedUnit, "decomposition.md");
    await writeFile(simulatedDecomposition, "# Accepted decomposition\n");
    const simulatedTask = await copyFixture(simulatedRoot, "follow-up-task.md");
    const simulatedGrant = await copyFixture(simulatedRoot, "designer-contracts-grant.json");
    const simulated = await invoke(
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
        simulatedTask,
        "--grant",
        simulatedGrant,
        "--simulate",
        "test",
        "--input",
        `brief=${resolve(simulatedUnit, "brief.md")}`,
        "--input",
        `accepted-decomposition=${simulatedDecomposition}`,
      ],
      simulatedRoot,
    );
    expect(simulated.stderr).toContain(
      "A finalized decomposition designer already owns this work item",
    );
    expect(simulated.stderr).toContain(`Continue ${prior} into contracts`);
  });

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
      targetAgent: [paseoAgentId],
      timeout: ["75 seconds; observation limit carried in instruction (CLI does not enforce)"],
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
    await writeFile(
      continuedRecord.response.path,
      "## Status\nComplete\n## Changed\nNone\n## Questions\nNone\n",
    );
    expect(
      (
        await invoke(
          [
            "launch",
            "complete",
            continuationPath,
            "--agent-id",
            paseoAgentId,
            "--status",
            "completed",
          ],
          root,
        )
      ).code,
    ).toBe(0);

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
    await started(root, "message-board-search", { review: "omitted" });
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
      targetAgent: [paseoAgentId],
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
      ["launch", "complete", recordPath, "--agent-id", paseoAgentId, "--status", "completed"],
      root,
    );
    expect(completion.code).toBe(0);
    const finalized = await readLaunchRecord(recordPath);
    expect(finalized).toMatchObject({
      state: "finalized",
      harness: "paseo",
      agentId: paseoAgentId,
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
          ["launch", "complete", initialPath, "--agent-id", paseoAgentId, "--status", "completed"],
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
        "Additional public framework references",
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
      "Additional public framework references": retainedContext(
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
      ["launch", "complete", continuedPath, "--agent-id", paseoAgentId, "--status", "completed"],
      root,
    );
    expect(staleCompletion).toEqual(cliFailure("Design changed after preparation"));
    await writeFile(specification, "# Posting\n\nRevised approved contract.\n", "utf8");
    expect(
      (
        await invoke(
          ["launch", "complete", continuedPath, "--agent-id", paseoAgentId, "--status", "failed"],
          root,
        )
      ).code,
    ).toBe(0);

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
      ["launch", "complete", refreshedPath, "--agent-id", paseoAgentId, "--status", "completed"],
      root,
    );
    expect(completed.code).toBe(0);
    expect(await readLaunchRecord(refreshedPath)).toMatchObject({
      state: "finalized",
      design: { root: design, before: currentDigest },
      harness: "paseo",
      agentId: paseoAgentId,
    });
  });

  test("warns on access expansion but not an unrequested harness change", async () => {
    const root = await application("continuation-integrity");
    await started(root);
    const initial = await prepareInitial(root, { grant: "designer-narrow-grant.json" });
    expect((await finalizeInitial(root, initial)).result.code).toBe(0);
    const followUpTask = await copyFixture(root, "follow-up-task.md");
    const fullGrant = await copyFixture(root, "designer-grant.json");

    const expansion = [
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
    ] as const;
    const expanded = await invoke(expansion, root);
    expect(expanded).toMatchObject({ code: 0, stderr: "" });
    expect(parseLabeledOutput(expanded.stdout).Warning).toEqual([
      "same-phase continuation access expands (readableAreas expands at design:.). Record the choice in the work brief when consequential.",
      "paseo capabilities are prompt-guided rather than harness-enforced.",
    ]);
    expect(await readLaunchRecord(reported(expanded.stdout, "Record"))).toMatchObject({
      grant: { readableAreas: expect.arrayContaining([{ area: "design", path: "." }]) },
    });

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
});
