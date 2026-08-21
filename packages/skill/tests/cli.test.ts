import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, test } from "vite-plus/test";

const command = resolve("packages/skill/skills/sync-engine/scripts/command.ts");
const taskBrief = resolve("packages/skill/tests/fixtures/task-manager/brief.md");
const temporary: string[] = [];

/** Commands report native paths; assertions on path shape read them separator-free. */
function posixPaths(output: string): string {
  return output.replaceAll("\\", "/");
}

/** macOS resolves the temp root through a symlink; commands report the real path. */
async function temporaryDirectory(prefix: string): Promise<string> {
  return realpath(await mkdtemp(resolve(tmpdir(), prefix)));
}

function run(args: readonly string[], cwd = process.cwd(), executable = command) {
  return spawnSync("bun", [executable, ...args], { cwd, encoding: "utf8" });
}

const executables: Record<string, string> = {
  "@mit-sdg/sync-engine": "sync-engine",
  "@mit-sdg/sync-engine-analysis": "sync-engine-analysis",
  "@mit-sdg/sync-engine-catalog": "sync-engine-catalog",
};

async function writePackage(
  directory: string,
  name: string,
  version: string,
  executable = executables[name],
): Promise<void> {
  const target = resolve(directory, "node_modules", name);
  const binTarget = "./dist/command.js";
  await mkdir(resolve(target, "dist"), { recursive: true });
  await writeFile(
    resolve(target, "package.json"),
    JSON.stringify({
      name,
      version,
      bin: executable === undefined ? {} : { [executable]: binTarget },
    }),
  );
  await writeFile(resolve(target, binTarget), "#!/usr/bin/env node\n");
}

async function writeConfiguredApplication(directory: string): Promise<void> {
  for (const name of Object.keys(executables)) {
    await writePackage(directory, name, "1.0.0-beta.15");
  }
  await Promise.all([
    writeFile(resolve(directory, "package.json"), '{"private":true,"type":"module"}\n'),
    writeFile(resolve(directory, "tsconfig.json"), "{}\n"),
    writeFile(resolve(directory, "generated.config.ts"), "export default {};\n"),
  ]);
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("sync-engine-skill command", () => {
  test("requires setup before initializing the exact brief template", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-brief-init-");
    temporary.push(directory);
    const path = resolve(directory, "product/brief.md");
    const premature = run(["brief", "init", path], directory);
    expect(premature.status).toBe(1);
    expect(premature.stderr).toContain("Brief init requires completed sync-engine setup");
    expect(premature.stderr).toContain("release check .");
    expect(premature.stderr).toContain("bunx --no-install sync-engine setup");
    await expect(readFile(path, "utf8")).rejects.toThrow();

    for (const name of Object.keys(executables)) {
      await writePackage(directory, name, "1.0.0-beta.15");
    }
    const unconfigured = run(["brief", "init", path], directory);
    expect(unconfigured.status).toBe(1);
    expect(unconfigured.stderr).toContain("missing setup files");
    await expect(readFile(path, "utf8")).rejects.toThrow();

    await writeConfiguredApplication(directory);
    const initialized = run(["brief", "init", path], directory);
    expect(initialized.status).toBe(0);
    expect(initialized.stdout).toContain("Brief template initialized. Fill placeholders.\n");
    expect(initialized.stdout).toContain(
      `Next: bun "<skill-root>/scripts/command.ts" brief check ${path}\n`,
    );
    expect(initialized.stdout).not.toContain(dirname(command));
    const template = await readFile(
      resolve("packages/skill/skills/sync-engine/prompts/templates/product-brief.md"),
      "utf8",
    );
    expect(await readFile(path, "utf8")).toBe(template);
    const repeated = run(["brief", "init", path], directory);
    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("Brief already exists");

    const filled = template
      .replace("<Product name>", "Product")
      .replace("<One short paragraph describing the useful outcome.>", "Deliver the product.")
      .replace(
        "- **D1 — <Decision title> (User):** <Decision and only the reason needed to understand it.>",
        "- **D1 — Scope (User):** Use one workspace.",
      )
      .replace("- <Externally observable successful behavior.>", "- A user completes the task.")
      .replace("- <Expected denied or rejected behavior.>", "- Invalid input is rejected.")
      .replace("- <Conservative assumption used to complete the design.>", "- Use local storage.")
      .replace("- <Behavior intentionally outside scope.>", "- Hosted deployment.");
    await writeFile(path, filled);
    const checked = run(["brief", "check", path], directory);
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("1 decisions, open decisions none");
    expect(checked.stdout).toContain("Next: read ");
    expect(posixPaths(checked.stdout)).toContain("references/design-and-criticism.md\n");
    expect(checked.stdout).toContain(
      `prompt build --role designer --mode map --input brief=${path}`,
    );
  });

  test("validates a brief before an application release set is installed", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-bootstrap-");
    temporary.push(directory);
    const result = run(["brief", "check", taskBrief], directory);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(
      /^Brief valid: \d+ bytes, 1 decisions, open decisions none; release 1\.0\.0-beta\.15\.\n/,
    );
    expect(result.stderr).toBe("");
  });

  test("writes prompt bytes into the workspace and reports sources separately", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-cli-");
    temporary.push(directory);
    const build = [
      "prompt",
      "build",
      "--role",
      "designer",
      "--mode",
      "map",
      "--input",
      `brief=${taskBrief}`,
    ];
    const first = run(build, directory);
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(first.stdout).toMatch(
      /Prompt built: role designer; mode map; tools decomposition-write-only; \d+ bytes; budget 32768; sha256 [a-f0-9]{64}/,
    );

    const written = (await readdir(resolve(directory, ".sync-engine"))).sort();
    expect(written).toHaveLength(2);
    const [contextName, promptName] = written as [string, string];
    expect(promptName).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-designer\.prompt\.md$/);
    expect(contextName).toBe(promptName.replace(/\.md$/, ".json"));
    const recorded = JSON.parse(
      await readFile(resolve(directory, ".sync-engine", contextName), "utf8"),
    );
    expect(recorded.role).toBe("designer");
    expect(recorded.mode).toBe("map");
    expect(recorded.toolPolicy).toBe("decomposition-write-only");
    expect(recorded.sha256).toBe(first.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1]);
    expect(recorded.briefSha256).toMatch(/^[a-f0-9]{64}$/);
    const output = resolve(directory, ".sync-engine", promptName);
    expect(first.stdout).toContain(`Next: deliver ${output} to a fresh designer as a file`);
    const prompt = await readFile(output, "utf8");
    expect(prompt).toContain("<!-- source: brief.md -->");
    expect(prompt).not.toContain(first.stdout);

    const second = run(build, directory);
    expect(second.status).toBe(0);
    expect(second.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1]).toBe(
      first.stdout.match(/sha256 ([a-f0-9]{64})/)?.[1],
    );
    expect((await readdir(resolve(directory, ".sync-engine"))).length).toBe(4);
  });

  test("keeps generated workflow files out of the design root", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-placement-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await writeFile(resolve(product, "brief.md"), "# Brief\n");
    const strayAssignment = resolve(design, "assignment.md");
    await writeFile(strayAssignment, "Assignment.\n");

    const digested = run(["design", "digest", design], directory);
    const digest = digested.stdout.match(/[a-f0-9]{64}/)?.[0];
    const rejected = run(
      [
        "prompt",
        "build",
        "--role",
        "concept-worker",
        "--input",
        `assignment=${strayAssignment}`,
        "--input",
        `specifications=${resolve(product, "brief.md")}`,
        "--design-root",
        design,
        "--design-digest",
        digest!,
      ],
      directory,
    );
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain(".sync-engine/");

    const strayFollowUp = resolve(design, "follow-up.md");
    await writeFile(strayFollowUp, "Rerun the check.\n");
    const refused = run(
      ["follow-up", "check", strayFollowUp, "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("Generated workflow files belong in .sync-engine/");
  });

  test("keeps stdout prompt bytes separate from the stderr report", () => {
    const result = run([
      "prompt",
      "build",
      "--role",
      "designer",
      "--mode",
      "map",
      "--input",
      `brief=${taskBrief}`,
      "--stdout",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Independent decomposition designer");
    expect(result.stdout).toContain("# Shared task manager");
    expect(result.stdout).not.toContain("Prompt built:");
    expect(result.stdout).not.toContain("Next:");
    expect(result.stdout).not.toContain(".sync-engine");
    expect(result.stderr).toContain("Prompt built: role designer");
    expect(result.stderr).toContain("Next: deliver the built prompt to a fresh designer as a file");
  });

  test("digests closed design and bounds diagnostic follow-ups", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-design-cli-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design);
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const digested = run(["design", "digest", design], directory);
    expect(digested.status).toBe(0);
    const digest = digested.stdout.match(/[a-f0-9]{64}/)?.[0];
    expect(digest).toBeDefined();
    expect(posixPaths(digested.stdout)).toContain("references/implementation.md\n");
    expect(digested.stdout).toContain(
      `Next: every downstream build and follow-up adds --design-root ${design} --design-digest ${digest}`,
    );

    await mkdir(resolve(directory, ".sync-engine"), { recursive: true });
    const named = resolve(directory, ".sync-engine", "repair.followup.md");
    await writeFile(named, "Run `bun run test`.\n");
    expect(
      run(
        ["follow-up", "check", named, "--design-root", design, "--design-digest", digest!],
        directory,
      ).stderr,
    ).toContain("start it with follow-up new");

    const started = run(["follow-up", "new", "--role", "concept-worker"], directory);
    expect(started.status).toBe(0);
    const followUp = started.stdout.match(/Follow-up started: (\S+)/)![1]!;
    await writeFile(followUp, "Run `bun run test`.\n");
    const checked = run(
      ["follow-up", "check", followUp, "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(checked.status).toBe(0);
    expect(checked.stdout).toContain("Follow-up valid");
    expect(checked.stdout).toContain(`Next: deliver ${followUp} to the original role as a file`);

    await writeFile(followUp, "x".repeat(4097));
    expect(
      run(
        ["follow-up", "check", followUp, "--design-root", design, "--design-digest", digest!],
        directory,
      ).stderr,
    ).toContain("maximum is 4096");
  });

  test("checks an installed application against the embedded release", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-version-");
    temporary.push(directory);
    for (const name of [
      "@mit-sdg/sync-engine",
      "@mit-sdg/sync-engine-analysis",
      "@mit-sdg/sync-engine-catalog",
    ]) {
      await writePackage(directory, name, "1.0.0-beta.15");
    }
    const valid = run(["release", "check", directory], directory);
    expect(valid.status).toBe(0);
    expect(valid.stdout).toContain("Installed sync-engine release matches skill 1.0.0-beta.15.\n");
    expect(valid.stdout).toContain("Next: bunx --no-install sync-engine setup\n");

    await rm(resolve(directory, "node_modules/@mit-sdg/sync-engine-catalog/dist/command.js"));
    const missingTarget = run(["release", "check", directory], directory);
    expect(missingTarget.status).toBe(1);
    expect(missingTarget.stderr).toContain("has missing or escaping target");
    await writePackage(directory, "@mit-sdg/sync-engine-catalog", "1.0.0-beta.15");

    await writePackage(directory, "@mit-sdg/sync-engine", "0.0.0");
    const mixed = run(["release", "check", directory], directory);
    expect(mixed.status).toBe(1);
    expect(mixed.stderr).toContain("does not match skill 1.0.0-beta.15");
    expect(mixed.stderr).toContain("@mit-sdg/sync-engine@0.0.0");

    await writePackage(directory, "@mit-sdg/sync-engine", "1.0.0-beta.15", "sync-engine");
    await writePackage(directory, "@mit-sdg/sync-engine-catalog", "1.0.0-beta.15", "catalog");
    const staleExecutable = run(["release", "check", directory], directory);
    expect(staleExecutable.status).toBe(1);
    expect(staleExecutable.stderr).toContain(
      "does not expose required executable sync-engine-catalog",
    );
  });

  test("does not accept an ancestor source package as an installed dependency", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-ancestor-");
    temporary.push(directory);
    await mkdir(resolve(directory, "application"));
    await writeFile(
      resolve(directory, "package.json"),
      JSON.stringify({
        name: "@mit-sdg/sync-engine",
        version: "1.0.0-beta.15",
        bin: { "sync-engine": "./dist/command.js" },
      }),
    );
    await mkdir(resolve(directory, "dist"));
    await writeFile(resolve(directory, "dist/command.js"), "#!/usr/bin/env node\n");
    for (const name of ["@mit-sdg/sync-engine-analysis", "@mit-sdg/sync-engine-catalog"]) {
      await writePackage(resolve(directory, "application"), name, "1.0.0-beta.15");
    }

    const result = run(
      ["release", "check", resolve(directory, "application")],
      resolve(directory, "application"),
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot resolve installed package @mit-sdg/sync-engine");
  });

  test("runs from a standalone copied skill without package installation", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-copy-");
    temporary.push(directory);
    const copiedSkill = resolve(directory, "sync-engine");
    await cp(resolve("packages/skill/skills/sync-engine"), copiedSkill, { recursive: true });
    const copiedCommand = resolve(copiedSkill, "scripts/command.ts");
    const result = run(
      ["prompt", "build", "--role", "designer", "--mode", "map", "--input", `brief=${taskBrief}`],
      directory,
      copiedCommand,
    );
    expect(result.status).toBe(0);
    const written = (await readdir(resolve(directory, ".sync-engine"))).sort();
    const output = resolve(directory, ".sync-engine", written[1]!);
    expect(await readFile(output, "utf8")).toContain("# Independent decomposition designer");
    expect(result.stdout).toContain(`Next: deliver ${output} to a fresh designer as a file`);
    expect(result.stdout).toContain(copiedSkill);
  });

  async function launchRecord(
    directory: string,
    role: string,
    options: {
      agentId?: string;
      promptBytes?: string;
      status?: string;
      designDigest?: string;
      mode?: "map" | "contract";
    } = {},
  ): Promise<string> {
    const workspace = resolve(directory, ".sync-engine");
    await mkdir(workspace, { recursive: true });
    const label = `${role}${options.mode === undefined ? "" : `-${options.mode}`}`;
    const promptPath = resolve(workspace, `2026-01-01T00-00-00Z-${label}.prompt.md`);
    const content = options.promptBytes ?? `# ${role}\n`;
    await writeFile(promptPath, content);
    const criticResponse =
      role !== "critic"
        ? undefined
        : options.mode === "map"
          ? "- ROW `design/decomposition.md` — Tasking — accept — one owner.\n" +
            "- PLACEMENT `N1` — accept — concept Tasking owns the lifecycle.\n"
          : "- CHECK `BRIEF` — Visible successes and refusals are traced.\n" +
            "- VERDICT — No material findings.\n";
    const responsePath =
      criticResponse === undefined
        ? undefined
        : resolve(workspace, `2026-01-01T00-04-00Z-${label}.response.md`);
    if (responsePath !== undefined) await writeFile(responsePath, criticResponse!);
    const record = {
      format: "sync-engine.skill.launch-record",
      version: 1,
      role,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      agentId: options.agentId ?? `agent-${role}`,
      provider: "paseo-test",
      model: "test-model",
      cwd: directory,
      prompt: {
        path: promptPath,
        sha256: createHash("sha256").update(content).digest("hex"),
        bytes: Buffer.byteLength(content, "utf8"),
      },
      ...(options.designDigest === undefined ? {} : { designDigest: options.designDigest }),
      startedAt: "2026-01-01T00:00:00.000Z",
      settledAt: "2026-01-01T00:05:00.000Z",
      status: options.status ?? "idle",
      ...(responsePath === undefined
        ? {}
        : {
            response: {
              path: responsePath,
              sha256: createHash("sha256").update(criticResponse!).digest("hex"),
              bytes: Buffer.byteLength(criticResponse!),
              contract: "met",
            },
          }),
    };
    const recordPath = resolve(workspace, `2026-01-01T00-05-00Z-${label}.launch.json`);
    await writeFile(recordPath, `${JSON.stringify(record, undefined, 2)}\n`);
    return recordPath;
  }

  test("builds a later role only after its predecessor actually ran", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-chain-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    await writeFile(resolve(design, "decomposition.md"), "# Decomposition\n");

    const criticArguments = [
      "prompt",
      "build",
      "--role",
      "critic",
      "--mode",
      "contract",
      "--input",
      `brief=${resolve(product, "brief.md")}`,
      "--input",
      `candidate=${resolve(design, "decomposition.md")}`,
      "--input",
      `candidate=${resolve(design, "types.md")}`,
    ];
    const ungated = run(criticArguments, directory);
    expect(ungated.status).toBe(1);
    expect(ungated.stderr).toContain(
      "Role critic contract requires a settled designer contract launch",
    );

    await launchRecord(directory, "designer", { mode: "contract" });
    const gated = run(criticArguments, directory);
    expect(gated.status).toBe(0);
    expect(gated.stdout).toContain("Prompt built: role critic");
  });

  test("records a direct user override of review judgment", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-user-override-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const map = resolve(design, "decomposition.md");
    await writeFile(map, "# Decomposition\n");
    await launchRecord(directory, "designer", { mode: "map" });

    const build = (override: boolean) =>
      run(
        [
          "prompt",
          "build",
          "--role",
          "designer",
          "--mode",
          "contract",
          "--input",
          `brief=${taskBrief}`,
          "--input",
          `map=${map}`,
          ...(override ? ["--user-override"] : []),
        ],
        directory,
      );

    expect(build(false).stderr).toContain("requires a settled critic map launch");
    const overridden = build(true);
    expect(overridden.status).toBe(0);
    expect(overridden.stdout).toContain("direct user override recorded");
    const prompt = overridden.stdout.match(/Next: deliver (\S+) to the original designer/)?.[1];
    const context = JSON.parse(await readFile(prompt!.replace(/\.md$/, ".json"), "utf8"));
    expect(context.userOverride).toBe(true);
  });

  test("stops counting a role once design reopens under it", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-reopened-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const reviewed = "b".repeat(64);
    await launchRecord(directory, "critic", { mode: "contract", designDigest: reviewed });
    const assignment = resolve(
      directory,
      ".sync-engine",
      "2026-01-01T00-06-00Z-concept-worker.assignment.md",
    );
    await writeFile(assignment, "# concept-worker assignment\n");

    const build = (digest: string) =>
      run(
        [
          "prompt",
          "build",
          "--role",
          "concept-worker",
          "--input",
          `assignment=${assignment}`,
          "--input",
          `specifications=${resolve(design, "types.md")}`,
          "--input",
          `examples=${resolve(design, "types.md")}`,
          "--design-root",
          design,
          "--design-digest",
          digest,
        ],
        directory,
      );

    const reopened = build("c".repeat(64));
    expect(reopened.status).toBe(1);
    expect(reopened.stderr).toContain("Design reopened after that role ran, so relaunch it");
  });

  test("treats a role that never settled as not having run", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-unsettled-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    await writeFile(resolve(design, "decomposition.md"), "# Decomposition\n");
    await launchRecord(directory, "designer", { status: "running", mode: "contract" });

    const result = run(
      [
        "prompt",
        "build",
        "--role",
        "critic",
        "--mode",
        "contract",
        "--input",
        `brief=${resolve(product, "brief.md")}`,
        "--input",
        `candidate=${resolve(design, "decomposition.md")}`,
        "--input",
        `candidate=${resolve(design, "types.md")}`,
      ],
      directory,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Role critic contract requires a settled designer contract launch",
    );
  });

  test("refuses a launch record whose prompt no longer matches", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-tamper-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    const product = resolve(directory, "product");
    await mkdir(product, { recursive: true });
    await cp(taskBrief, resolve(product, "brief.md"));
    await writeFile(resolve(design, "types.md"), "# Types\n");
    await writeFile(resolve(design, "decomposition.md"), "# Decomposition\n");
    await launchRecord(directory, "designer", { mode: "contract" });
    await writeFile(
      resolve(directory, ".sync-engine", "2026-01-01T00-00-00Z-designer-contract.prompt.md"),
      "# replaced after the fact\n",
    );

    const result = run(
      [
        "prompt",
        "build",
        "--role",
        "critic",
        "--mode",
        "contract",
        "--input",
        `brief=${resolve(product, "brief.md")}`,
        "--input",
        `candidate=${resolve(design, "decomposition.md")}`,
        "--input",
        `candidate=${resolve(design, "types.md")}`,
      ],
      directory,
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Role critic contract requires a settled designer contract launch",
    );
  });

  test("handback names every role that has no independent evidence", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-handback-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const digest = run(["design", "digest", design], directory).stdout.match(/[a-f0-9]{64}/)?.[0];

    const empty = run(
      ["handback", "check", "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain(
      "no settled launch for: designer map, critic map, designer contract, critic contract, concept-worker, application-worker, evidence-worker",
    );

    await launchRecord(directory, "designer", {
      agentId: "invented-agent-id",
      mode: "map",
    });
    const invented = run(
      ["handback", "check", "--design-root", design, "--design-digest", digest!],
      directory,
    );
    expect(invented.status).toBe(1);
    expect(invented.stdout).toContain("agent invented-agent-id UNKNOWN to paseo");
    expect(invented.stderr).toContain("paseo does not know: designer map invented-agent-id");
  });

  test("lets a direct user waive missing phases at handback without claiming evidence", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-handback-override-");
    temporary.push(directory);
    const design = resolve(directory, "design");
    await mkdir(design, { recursive: true });
    await writeFile(resolve(design, "types.md"), "# Types\n");
    const digest = run(["design", "digest", design], directory).stdout.match(/[a-f0-9]{64}/)?.[0];

    const result = run(
      ["handback", "check", "--design-root", design, "--design-digest", digest!, "--user-override"],
      directory,
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("designer map: USER-OVERRIDDEN");
    expect(result.stdout).toContain("not represented as independently completed");
    expect(result.stdout).toContain("Every non-waived required role phase");
  });

  test("refuses an assignment that crosses role ownership", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-assignment-");
    temporary.push(directory);
    const started = run(
      ["assignment", "new", "--role", "concept-worker", "--design-digest", "a".repeat(64)],
      directory,
    );
    expect(started.status).toBe(0);
    const path = started.stdout.match(/Assignment started: (\S+)/)?.[1];
    expect(dirname(path!)).toBe(resolve(directory, ".sync-engine"));
    expect(basename(path!)).toMatch(/^\d{4}-.*-concept-worker\.assignment\.md$/);

    const complete = `# concept-worker assignment

## Storage guarantee

In-memory only; nothing survives restart, per the brief's demo decision.

## Allowed write paths

- \`src/concepts/Shortening.ts\`
- \`tests/concepts/Shortening.test.ts\`

## Commands

- \`bun test tests/concepts/\`
- \`tsc --noEmit\`

## Execution budget

- Max tool calls: 24
- Max runs per command: 2
- Repairs per diagnostic signature: 1
`;
    await writeFile(path!, complete);
    expect(run(["assignment", "check", path!], directory).status).toBe(0);

    await writeFile(path!, complete.replace("Max tool calls: 24", "Max tool calls: 40"));
    const unbounded = run(["assignment", "check", path!], directory);
    expect(unbounded.status).toBe(1);
    expect(unbounded.stderr).toContain("must state Max tool calls: 24");

    await writeFile(
      path!,
      complete.replace(
        "- `tests/concepts/Shortening.test.ts`",
        "- `tests/concepts/Shortening.test.ts`\n- `src/concepts/Shortening.registry.ts`",
      ),
    );
    const crossed = run(["assignment", "check", path!], directory);
    expect(crossed.status).toBe(1);
    expect(crossed.stderr).toContain(
      "Assignment gives concept-worker a path owned by the application worker: src/concepts/Shortening.registry.ts",
    );

    await writeFile(
      path!,
      complete.replace("- `tsc --noEmit`", "- `bunx --no-install sync-engine check`"),
    );
    const wide = run(["assignment", "check", path!], directory);
    expect(wide.status).toBe(1);
    expect(wide.stderr).toContain("application-wide command `sync-engine check`");

    await writeFile(
      path!,
      complete.replace(/## Storage guarantee[\s\S]*?## Allowed/, "## Allowed"),
    );
    const unstated = run(["assignment", "check", path!], directory);
    expect(unstated.status).toBe(1);
    expect(unstated.stderr).toContain("Assignment states no storage guarantee");

    await writeFile(
      path!,
      complete.replace(
        "## Allowed write paths",
        `## Allowed read paths

- \`node_modules/@mit-sdg/sync-engine/examples/message-board/src/concepts/Posting.registry.ts\`

## Allowed write paths`,
      ),
    );
    expect(run(["assignment", "check", path!], directory).status).toBe(0);
  });

  test("names the roles and slots instead of sending the coordinator to the source", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-roles-");
    temporary.push(directory);
    const unknown = run(
      ["assignment", "new", "--role", "concept", "--design-digest", "a".repeat(64)],
      directory,
    );
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain(
      "Unknown role: concept; roles are designer, critic, concept-worker, application-worker, frontend-worker, evidence-worker",
    );
    expect(run(["--help"], directory).stdout).toContain(
      "designer, critic, concept-worker, application-worker, frontend-worker, evidence-worker",
    );

    await writeConfiguredApplication(directory);
    const brief = resolve(directory, "product", "brief.md");
    await mkdir(dirname(brief), { recursive: true });
    await cp(taskBrief, brief);
    const wrongSlot = run(
      ["prompt", "build", "--role", "designer", "--mode", "map", "--input", `outline=${brief}`],
      directory,
    );
    expect(wrongSlot.status).toBe(1);
    expect(wrongSlot.stderr).toContain("Role designer has no input slot: outline; its slots are");
  });

  test("names follow-up files itself", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-followup-");
    temporary.push(directory);
    const started = run(["follow-up", "new", "--role", "concept-worker"], directory);
    expect(started.status).toBe(0);
    const path = started.stdout.match(/Follow-up started: (\S+)/)?.[1];
    expect(dirname(path!)).toBe(resolve(directory, ".sync-engine"));
    expect(basename(path!)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d-]+Z-concept-worker\.followup\.md$/);
    expect(await readFile(path!, "utf8")).toBe("");

    const second = run(["follow-up", "new", "--role", "concept-worker"], directory);
    expect(second.status).toBe(0);
    expect(second.stdout.match(/Follow-up started: (\S+)/)?.[1]).not.toBe(path);

    expect(run(["follow-up", "new", "--role", "designer-2"], directory).status).toBe(1);
  });

  test("launches only through the harness and only from the workspace", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-launch-");
    temporary.push(directory);
    const stray = resolve(directory, "designer.prompt.md");
    await writeFile(stray, "# designer\n");
    const outside = run(["launch", "--role", "designer", "--prompt", stray], directory);
    expect(outside.status).toBe(1);
    expect(outside.stderr).toContain("Generated workflow files belong in .sync-engine/");

    const built = run(
      ["prompt", "build", "--role", "designer", "--mode", "map", "--input", `brief=${taskBrief}`],
      directory,
    );
    expect(built.status).toBe(0);
    const inside = built.stdout.match(/Next: deliver (\S+) to a fresh designer/)?.[1];
    expect(inside).toBeDefined();
    const unparented = spawnSync(
      "bun",
      [command, "launch", "--role", "designer", "--prompt", inside!],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, PASEO_AGENT_ID: "" },
      },
    );
    expect(unparented.status).toBe(1);
    expect(unparented.stderr).toContain("PASEO_AGENT_ID is unset");

    const unknownRole = run(["launch", "--role", "reviewer", "--prompt", inside!], directory);
    expect(unknownRole.status).toBe(1);
    expect(unknownRole.stderr).toContain("Unknown role: reviewer");
  });

  test("records a coordinator-mediated native launch without Paseo", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-native-launch-");
    temporary.push(directory);
    const built = run(
      ["prompt", "build", "--role", "designer", "--mode", "map", "--input", `brief=${taskBrief}`],
      directory,
    );
    expect(built.status).toBe(0);
    const prompt = built.stdout.match(/Next: deliver (\S+) to a fresh designer/)?.[1];
    expect(prompt).toBeDefined();

    const prepared = run(
      ["launch", "prepare", "--harness", "codex", "--role", "designer", "--prompt", prompt!],
      directory,
    );
    expect(prepared.status).toBe(0);
    expect(prepared.stdout).toContain("Native launch prepared: role designer; harness codex");
    expect(prepared.stdout).toContain("Read ");
    expect(posixPaths(prepared.stdout)).toContain("references/harnesses/codex.md");
    const ticket = prepared.stdout.match(/ticket (\S+); response/)?.[1];
    const response = prepared.stdout.match(/response (\S+)\./)?.[1];
    expect(ticket).toBeDefined();
    expect(response).toBeDefined();
    await writeFile(response!, "Changed: design/decomposition.md\nQuestions: none\n");

    const completed = run(
      ["launch", "complete", "--ticket", ticket!, "--agent-id", "codex-agent-1"],
      directory,
    );
    expect(completed.status).toBe(0);
    expect(completed.stdout).toContain(
      "Completed designer through codex: agent codex-agent-1; native model inheritance recorded but not machine-attested; tools decomposition-write-only",
    );
    const launchPath = completed.stdout.match(/record (\S+)\./)?.[1];
    const record = JSON.parse(await readFile(launchPath!, "utf8"));
    expect(record).toMatchObject({
      role: "designer",
      mode: "map",
      toolPolicy: "decomposition-write-only",
      agentId: "codex-agent-1",
      harness: "codex",
      attestation: "coordinator",
      status: "settled",
      readAudit: "unavailable",
    });
    expect(record.provider).toBeUndefined();
    expect(record.model).toBeUndefined();

    await launchRecord(directory, "critic", { mode: "map" });
    const map = resolve(directory, "design/decomposition.md");
    const review = resolve(directory, "map-review.md");
    await mkdir(dirname(map), { recursive: true });
    await writeFile(map, "# Decomposition\n");
    await writeFile(review, "- ROW accepted\n");
    const contractBuilt = run(
      [
        "prompt",
        "build",
        "--role",
        "designer",
        "--mode",
        "contract",
        "--input",
        `brief=${taskBrief}`,
        "--input",
        `map=${map}`,
        "--input",
        `review=${review}`,
      ],
      directory,
    );
    expect(contractBuilt.status).toBe(0);
    const contractPrompt = contractBuilt.stdout.match(
      /Next: deliver (\S+) to the original designer/,
    )?.[1];
    const crossHarness = run(
      [
        "launch",
        "prepare",
        "--harness",
        "claude-code",
        "--role",
        "designer",
        "--prompt",
        contractPrompt!,
        "--continue-agent",
        "codex-agent-1",
      ],
      directory,
    );
    expect(crossHarness.status).toBe(1);
    expect(crossHarness.stderr).toContain("no settled designer map record through claude-code");

    const continuation = run(
      [
        "launch",
        "prepare",
        "--harness",
        "codex",
        "--role",
        "designer",
        "--prompt",
        contractPrompt!,
        "--continue-agent",
        "codex-agent-1",
      ],
      directory,
    );
    expect(continuation.status).toBe(0);
    expect(continuation.stdout).toContain("send ");
    expect(continuation.stdout).toContain("to native agent codex-agent-1");
    const continuationTicket = continuation.stdout.match(/ticket (\S+); response/)?.[1];
    const continuationResponse = continuation.stdout.match(/response (\S+)\./)?.[1];
    await writeFile(
      continuationResponse!,
      "Changed:\n- design/concepts/Tasking.md\nCheck: passed\nBlocker: none\n",
    );
    const wrongAgent = run(
      ["launch", "complete", "--ticket", continuationTicket!, "--agent-id", "replacement-agent"],
      directory,
    );
    expect(wrongAgent.status).toBe(1);
    expect(wrongAgent.stderr).toContain("Continuation ticket requires agent codex-agent-1");
    const continued = run(
      ["launch", "complete", "--ticket", continuationTicket!, "--agent-id", "codex-agent-1"],
      directory,
    );
    expect(continued.status).toBe(0);
    const continuationRecordPath = continued.stdout.match(/record (\S+)\./)?.[1];
    expect(JSON.parse(await readFile(continuationRecordPath!, "utf8"))).toMatchObject({
      role: "designer",
      mode: "contract",
      agentId: "codex-agent-1",
    });

    const repeated = run(
      ["launch", "complete", "--ticket", ticket!, "--agent-id", "codex-agent-1"],
      directory,
    );
    expect(repeated.status).toBe(1);
    expect(repeated.stderr).toContain("Launch ticket was already completed");
  });

  test("rejects malformed native launch preparation and returns", async () => {
    const directory = await temporaryDirectory("sync-engine-skill-native-invalid-");
    temporary.push(directory);
    await mkdir(resolve(directory, ".sync-engine"));
    const prompt = resolve(directory, ".sync-engine/designer.prompt.md");
    await writeFile(prompt, "# designer\n");
    const unbuilt = run(
      ["launch", "prepare", "--harness", "claude-code", "--role", "designer", "--prompt", prompt],
      directory,
    );
    expect(unbuilt.status).toBe(1);
    expect(unbuilt.stderr).toContain("requires a prompt written by prompt build");

    const unknown = run(
      ["launch", "prepare", "--harness", "unknown", "--role", "designer", "--prompt", prompt],
      directory,
    );
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("Unknown native harness");
  });

  test("reports concise usage and argument failures", () => {
    expect(run(["--help"]).stdout).toContain("sync-engine-skill prompt build");
    const missing = run(["prompt", "build"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("prompt build requires --role");
  });
});
